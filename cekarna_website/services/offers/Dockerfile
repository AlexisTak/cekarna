FROM rust:1.85-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release --locked
FROM debian:bookworm-slim
RUN useradd --system --uid 65532 app && mkdir /data /app && chown app:app /data
COPY --from=build /src/target/release/cekarna-offers /usr/local/bin/offers
COPY sources.toml /app/sources.toml
ENV OFFERS_ADDR=0.0.0.0:8083 OFFERS_DATABASE_PATH=/data/offers.db OFFERS_SOURCES_PATH=/app/sources.toml
USER 65532:65532
EXPOSE 8083
ENTRYPOINT ["offers"]
