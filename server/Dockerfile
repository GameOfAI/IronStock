FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /envanter-api ./cmd/api && \
    go install github.com/pressly/goose/v3/cmd/goose@v3.22.0 && \
    cp $(go env GOPATH)/bin/goose /goose

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /envanter-api /envanter-api
COPY --from=builder /goose /goose
COPY migrations /migrations
EXPOSE 8080
ENTRYPOINT ["/envanter-api"]
