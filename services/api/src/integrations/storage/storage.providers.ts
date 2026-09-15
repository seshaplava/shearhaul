import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BlobServiceClient,
  BlobSASPermissions,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { StorageProvider } from '../ports';

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;
  private readonly publicBase: string;

  constructor(config: ConfigService) {
    this.root = config.get('LOCAL_STORAGE_DIR') ?? join(process.cwd(), 'storage');
    this.publicBase =
      config.get('LOCAL_STORAGE_PUBLIC_BASE') ??
      `http://localhost:${config.get('PORT') ?? 3000}/v1/storage/download?key=`;
    if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true });
  }

  async createUploadUrl(params: {
    key: string;
    contentType: string;
    expiresSec?: number;
  }) {
    const base = `http://localhost:${process.env.PORT ?? 3000}/v1`;
    return {
      uploadUrl: `${base}/storage/upload?key=${encodeURIComponent(params.key)}`,
      key: params.key,
      publicOrSignedGetUrl: `${this.publicBase}${encodeURIComponent(params.key)}`,
    };
  }

  async createDownloadUrl(key: string) {
    return `${this.publicBase}${encodeURIComponent(key)}`;
  }

  async putObject(key: string, body: Buffer, _contentType: string) {
    const full = join(this.root, key);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    return { key };
  }

  resolvePath(key: string) {
    return join(this.root, key);
  }
}

/** Primary cloud storage for ShareHaul (Azure Blob). */
@Injectable()
export class AzureBlobStorageProvider implements StorageProvider {
  readonly name = 'azure';
  private readonly log = new Logger(AzureBlobStorageProvider.name);
  private readonly container: string;
  private accountName: string;
  private readonly credential: StorageSharedKeyCredential | null;
  private readonly service: BlobServiceClient | null;

  constructor(private readonly config: ConfigService) {
    this.container =
      config.get('AZURE_STORAGE_CONTAINER') ?? 'sharehaul-docs';
    this.accountName = config.get('AZURE_STORAGE_ACCOUNT') ?? '';
    const accountKey = config.get<string>('AZURE_STORAGE_ACCOUNT_KEY');
    const connectionString = config.get<string>('AZURE_STORAGE_CONNECTION_STRING');

    if (connectionString) {
      this.service = BlobServiceClient.fromConnectionString(connectionString);
      const m = /AccountName=([^;]+)/i.exec(connectionString);
      if (m) this.accountName = m[1];
      const k = /AccountKey=([^;]+)/i.exec(connectionString);
      if (k && this.accountName) {
        this.credential = new StorageSharedKeyCredential(
          this.accountName,
          k[1],
        );
      } else {
        this.credential = null;
      }
    } else if (this.accountName && accountKey) {
      this.credential = new StorageSharedKeyCredential(
        this.accountName,
        accountKey,
      );
      this.service = new BlobServiceClient(
        `https://${this.accountName}.blob.core.windows.net`,
        this.credential,
      );
    } else {
      this.service = null;
      this.credential = null;
    }
  }

  private assertReady() {
    if (!this.service) {
      throw new Error(
        'Azure storage not configured — set AZURE_STORAGE_CONNECTION_STRING or ACCOUNT+KEY',
      );
    }
  }

  private async ensureContainer() {
    this.assertReady();
    const client = this.service!.getContainerClient(this.container);
    await client.createIfNotExists();
    return client;
  }

  private sasUrl(blobName: string, permissions: string, expiresSec: number) {
    if (!this.credential || !this.accountName) {
      throw new Error('Azure credentials required for SAS URLs');
    }
    const startsOn = new Date();
    const expiresOn = new Date(Date.now() + expiresSec * 1000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container,
        blobName,
        permissions: BlobSASPermissions.parse(permissions),
        startsOn,
        expiresOn,
      },
      this.credential,
    ).toString();
    return `https://${this.accountName}.blob.core.windows.net/${this.container}/${encodeURIComponent(blobName).replace(/%2F/g, '/')}?${sas}`;
  }

  async createUploadUrl(params: {
    key: string;
    contentType: string;
    expiresSec?: number;
  }) {
    await this.ensureContainer();
    const uploadUrl = this.sasUrl(params.key, 'cw', params.expiresSec ?? 900);
    const getUrl = await this.createDownloadUrl(params.key, 3600);
    return {
      uploadUrl,
      key: params.key,
      publicOrSignedGetUrl: getUrl,
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': params.contentType },
    };
  }

  async createDownloadUrl(key: string, expiresSec = 3600) {
    this.assertReady();
    return this.sasUrl(key, 'r', expiresSec);
  }

  async putObject(key: string, body: Buffer, contentType: string) {
    const container = await this.ensureContainer();
    const blob = container.getBlockBlobClient(key);
    await blob.uploadData(body, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    this.log.log(`Uploaded azure://${this.container}/${key}`);
    return { key };
  }
}

/** Optional legacy AWS S3 — prefer Azure for this project. */
@Injectable()
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  private readonly log = new Logger(S3StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('S3_BUCKET') ?? '';
    this.client = new S3Client({
      region: config.get('AWS_REGION') ?? 'ap-south-1',
      credentials:
        config.get('AWS_ACCESS_KEY_ID') && config.get('AWS_SECRET_ACCESS_KEY')
          ? {
              accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID')!,
              secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY')!,
            }
          : undefined,
    });
  }

  async createUploadUrl(params: {
    key: string;
    contentType: string;
    expiresSec?: number;
  }) {
    if (!this.bucket) throw new Error('S3_BUCKET missing');
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, cmd, {
      expiresIn: params.expiresSec ?? 900,
    });
    const getUrl = await this.createDownloadUrl(params.key, 3600);
    return { uploadUrl, key: params.key, publicOrSignedGetUrl: getUrl };
  }

  async createDownloadUrl(key: string, expiresSec = 3600) {
    if (!this.bucket) throw new Error('S3_BUCKET missing');
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresSec });
  }

  async putObject(key: string, body: Buffer, contentType: string) {
    if (!this.bucket) throw new Error('S3_BUCKET missing');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    this.log.log(`Uploaded s3://${this.bucket}/${key}`);
    return { key };
  }
}
