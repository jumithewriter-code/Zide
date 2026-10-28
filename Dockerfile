# Zide gateway. Railway: add a volume mounted at /data and set ZIDE_UFVK + ZIDE_PUBLIC_URL.
FROM rust:1-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY sdk ./sdk
RUN cargo build --release -p gateway

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/gateway /usr/local/bin/gateway
ENV ZIDE_NETWORK=test ZIDE_DB=/data/zide.sqlite ZIDE_LP_KEYS=/data/lp-keys.json
WORKDIR /data
CMD ["gateway"]
