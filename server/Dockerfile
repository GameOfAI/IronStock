# goose: download pre-built binary (avoids slow QEMU cross-compilation)
FROM alpine:3.19 AS goose-dl
ARG TARGETARCH
RUN apk --no-cache add wget && \
    GOOSE_VERSION=3.22.0 && \
    wget -q "https://github.com/pressly/goose/releases/download/v${GOOSE_VERSION}/goose_linux_${TARGETARCH}" \
         -O /goose && \
    chmod +x /goose

FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /envanter-api ./cmd/api

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /envanter-api /envanter-api
COPY --from=goose-dl /goose /goose
COPY migrations /migrations
EXPOSE 8080
ENTRYPOINT ["/envanter-api"]
