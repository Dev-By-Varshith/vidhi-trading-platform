FROM golang:1.22-bookworm AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o vidhi-botfleet .

FROM scratch
COPY --from=builder /app/vidhi-botfleet /vidhi-botfleet
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
EXPOSE 9090
ENTRYPOINT ["/vidhi-botfleet"]
