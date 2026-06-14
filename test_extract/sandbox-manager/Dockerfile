FROM golang:alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go get github.com/pkg/errors@v0.9.1 && go mod tidy
RUN go build -o sandbox-manager .

FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/sandbox-manager .
COPY seccomp.json .

# Install docker CLI so spawner can use it or API can talk to socket
RUN apk add --no-cache docker-cli

EXPOSE 8081
CMD ["./sandbox-manager"]
