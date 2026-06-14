FROM golang:alpine AS builder
WORKDIR /app
COPY . .
RUN go mod download && go get github.com/pkg/errors@v0.9.1 && go mod tidy && go build -o sandbox-manager .

FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/sandbox-manager .
COPY seccomp.json .
RUN apk add --no-cache docker-cli

EXPOSE 8081
CMD ["./sandbox-manager"]
