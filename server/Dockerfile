FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /envanter-api ./cmd/api

FROM scratch
COPY --from=builder /envanter-api /envanter-api
EXPOSE 8080
ENTRYPOINT ["/envanter-api"]
