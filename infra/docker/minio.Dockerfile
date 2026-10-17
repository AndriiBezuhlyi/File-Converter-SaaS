# syntax=docker/dockerfile:1
# Local development only: the official Community edition is source-only.
FROM golang:1.26-bookworm AS build
ARG MINIO_REF=7aac2a2c5b7c882e68c1ce017d8256be2feea27f
ARG MC_REF=77f82e18b5401a65958f1619df6ebb994634bd88
RUN CGO_ENABLED=0 go install github.com/minio/minio@${MINIO_REF}
RUN CGO_ENABLED=0 go install github.com/minio/mc@${MC_REF}
RUN mkdir /licenses && find /go/pkg/mod/github.com/minio -maxdepth 2 -name LICENSE -exec cp --parents {} /licenses/ \;

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home minio \
    && mkdir /data && chown minio:minio /data
COPY --from=build /go/bin/minio /usr/local/bin/minio
COPY --from=build /go/bin/mc /usr/local/bin/mc
COPY --from=build /licenses /usr/share/doc/minio
USER minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
