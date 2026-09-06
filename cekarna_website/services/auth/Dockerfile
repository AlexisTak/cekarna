FROM golang:1.26.6-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /auth ./cmd/auth

FROM build AS test
RUN apk add --no-cache gcc musl-dev
ENV CGO_ENABLED=1
CMD ["go", "test", "-race", "-count=1", "-v", "./..."]

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /auth /auth
USER 65532:65532
EXPOSE 8081
ENTRYPOINT ["/auth"]
