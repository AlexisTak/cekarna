FROM rust:1.96-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && printf 'fn main() {}\n' > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs && cargo build --release --locked

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --create-home app
COPY --from=build /app/target/release/cekarna-notifications /usr/local/bin/cekarna-notifications
USER 10001
EXPOSE 8082
ENTRYPOINT ["cekarna-notifications"]
