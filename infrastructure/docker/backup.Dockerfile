FROM alpine:3.20
# MinIO's own `mc` client binary download (dl.min.io) has gone the same way as their
# Docker Hub image — no longer a valid anonymous download (confirmed on the NAS: the
# "binary" turned out to be an HTML/text error page). rclone (packaged, from Alpine's
# repo, not a raw curl download) talks S3-compatible APIs natively and is used for
# every MinIO operation instead — one tool for both the local mirror and any future
# offsite target.
RUN apk add --no-cache bash postgresql16-client curl rclone ca-certificates

COPY infrastructure/backup /backup
WORKDIR /backup
RUN chmod +x *.sh targets/*.sh 2>/dev/null || true

ENTRYPOINT ["/bin/bash"]
CMD ["/backup/backup.sh"]
