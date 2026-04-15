FROM golang:1.23 AS build
WORKDIR /src
COPY apps/viper-proxy/ .
RUN go mod download && CGO_ENABLED=0 go build -o /out/viper-proxy ./cmd/viper-proxy

FROM gcr.io/distroless/base-debian12
WORKDIR /app
COPY --from=build /out/viper-proxy /app/viper-proxy
EXPOSE 8080
ENTRYPOINT ["/app/viper-proxy"]
