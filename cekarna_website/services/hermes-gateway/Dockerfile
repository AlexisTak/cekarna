FROM rust:1.85-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN useradd --system --uid 65532 app
COPY --from=build /src/target/release/cekarna-hermes-gateway /usr/local/bin/hermes-gateway
USER 65532:65532
EXPOSE 8084
ENTRYPOINT ["hermes-gateway"]
