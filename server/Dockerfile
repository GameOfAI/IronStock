# Build on native platform (no QEMU) and cross-compile for target arch.
# Both API and goose are compiled natively using GOOS/GOARCH cross-compilation.
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS builder
ARG TARGETARCH
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
# Cross-compile API binary natively (fast, no QEMU)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -o /envanter-api ./cmd/api
# Cross-compile goose natively; GOBIN ensures it lands at a known path
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} GOBIN=/goose-bin \
    go install github.com/pressly/goose/v3/cmd/goose@v3.22.0

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /envanter-api /envanter-api
COPY --from=builder /goose-bin/goose /goose
COPY migrations /migrations
EXPOSE 8080
ENTRYPOINT ["/envanter-api"]
