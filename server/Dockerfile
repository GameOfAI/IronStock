# Build on native platform (no QEMU) and cross-compile for target arch.
# Base image must satisfy server/go.mod's `go 1.25.0` directive — the official
# golang images pin GOTOOLCHAIN=local, so an older base fails the build even
# though CI/local (GOTOOLCHAIN=auto) would auto-download the toolchain.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS builder
ARG TARGETARCH
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -o /envanter-api ./cmd/api
# go install with cross-compile puts binary in /go/bin/linux_<arch>/ (not /go/bin/).
# find copies it to a known path regardless of native vs cross build.
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go install github.com/pressly/goose/v3/cmd/goose@v3.22.0 && \
    find /go/bin -name goose -exec cp {} /goose \;

FROM alpine:3.23
RUN apk --no-cache add ca-certificates
COPY --from=builder /envanter-api /envanter-api
COPY --from=builder /goose /goose
COPY migrations /migrations
EXPOSE 8080
ENTRYPOINT ["/envanter-api"]
