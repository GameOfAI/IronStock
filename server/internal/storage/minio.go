package storage

import (
	"context"
	"io"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// MinioBackend implements Backend using a MinIO (S3-compatible) server.
type MinioBackend struct {
	client *minio.Client
}

// NewMinioBackend connects to a MinIO/S3 endpoint.
// endpoint: host:port (e.g. "minio:9000")
// useSSL:   false for in-cluster HTTP, true for HTTPS
func NewMinioBackend(endpoint, accessKey, secretKey string, useSSL bool) (*MinioBackend, error) {
	c, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}
	return &MinioBackend{client: c}, nil
}

// EnsureBucket creates bucket if it does not already exist.
func (m *MinioBackend) EnsureBucket(ctx context.Context, bucket string) error {
	exists, err := m.client.BucketExists(ctx, bucket)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	return m.client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{})
}

// Put uploads data from r as key in bucket.
func (m *MinioBackend) Put(ctx context.Context, bucket, key, contentType string, r io.Reader, size int64) error {
	_, err := m.client.PutObject(ctx, bucket, key, r, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	return err
}

// Get returns the object reader for key in bucket. Caller must close it.
func (m *MinioBackend) Get(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	obj, err := m.client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	return obj, nil
}

// Delete removes key from bucket. Returns nil if the object did not exist.
func (m *MinioBackend) Delete(ctx context.Context, bucket, key string) error {
	return m.client.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
}

// PresignGetURL returns a time-limited URL for downloading key from bucket.
func (m *MinioBackend) PresignGetURL(ctx context.Context, bucket, key string, expiry time.Duration) (string, error) {
	u, err := m.client.PresignedGetObject(ctx, bucket, key, expiry, url.Values{})
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

// PresignPutURL returns a time-limited URL for uploading to key in bucket.
func (m *MinioBackend) PresignPutURL(ctx context.Context, bucket, key string, expiry time.Duration) (string, error) {
	u, err := m.client.PresignedPutObject(ctx, bucket, key, expiry)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}
