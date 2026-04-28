// Package storage defines the Backend interface for object storage
// (MinIO in production, in-memory or temp-dir in tests).
package storage

import (
	"context"
	"io"
	"time"
)

// Backend abstracts S3-compatible object storage operations.
// Implementations: MinioBackend (production), MemBackend (tests).
type Backend interface {
	// EnsureBucket creates the bucket if it does not already exist.
	EnsureBucket(ctx context.Context, bucket string) error

	// Put uploads data from r as key in bucket.
	Put(ctx context.Context, bucket, key, contentType string, r io.Reader, size int64) error

	// Get returns the object reader for key in bucket. Caller must close it.
	Get(ctx context.Context, bucket, key string) (io.ReadCloser, error)

	// Delete removes key from bucket. Returns nil if the object did not exist.
	Delete(ctx context.Context, bucket, key string) error

	// PresignGetURL returns a time-limited URL for downloading key from bucket.
	PresignGetURL(ctx context.Context, bucket, key string, expiry time.Duration) (string, error)

	// PresignPutURL returns a time-limited URL for uploading to key in bucket.
	PresignPutURL(ctx context.Context, bucket, key string, expiry time.Duration) (string, error)
}
