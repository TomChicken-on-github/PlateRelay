import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertKey, type ObjectStorage } from "./storage.js";

export interface S3Config {
  /** Address the panel uses, e.g. https://oss-cn-beijing.aliyuncs.com */
  endpoint: string;
  /** Address browsers use for signed links, when it differs (brief §0.5). */
  publicEndpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing (MinIO and similar); Aliyun OSS needs virtual-hosted style. */
  forcePathStyle: boolean;
}

/**
 * S3-compatible object storage (Aliyun OSS, MinIO…). The bucket stays
 * private; browsers only get short-lived presigned GET links.
 */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly signer: S3Client;

  constructor(private readonly c: S3Config) {
    const base = {
      region: c.region,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      forcePathStyle: c.forcePathStyle,
      /* OSS rejects the CRC32 checksum headers newer SDKs add by default */
      requestChecksumCalculation: "WHEN_REQUIRED" as const,
      responseChecksumValidation: "WHEN_REQUIRED" as const,
    };
    this.client = new S3Client({ ...base, endpoint: c.endpoint });
    this.signer = c.publicEndpoint ? new S3Client({ ...base, endpoint: c.publicEndpoint }) : this.client;
  }

  async put(key: string, data: Uint8Array, contentType: string) {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.c.bucket, Key: key, Body: data, ContentType: contentType, ContentLength: data.byteLength }));
  }

  async get(key: string): Promise<Readable> {
    assertKey(key);
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.c.bucket, Key: key }));
    return r.Body as Readable;
  }

  async delete(key: string) {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.c.bucket, Key: key }));
  }

  async exists(key: string) {
    assertKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.c.bucket, Key: key }));
      return true;
    } catch (e) {
      if (e instanceof S3ServiceException && e.$metadata.httpStatusCode === 404) return false;
      throw e;
    }
  }

  async list(prefix: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.c.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
  }

  /** Signing happens locally; it makes no request to the storage service. */
  async signedUrl(key: string, ttlSeconds: number, downloadName?: string) {
    assertKey(key);
    const cmd = new GetObjectCommand({
      Bucket: this.c.bucket,
      Key: key,
      ResponseContentDisposition: downloadName ? `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` : undefined,
    });
    return getSignedUrl(this.signer, cmd, { expiresIn: ttlSeconds });
  }
}
