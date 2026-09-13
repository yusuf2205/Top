FROM alpine:3.20
RUN apk add --no-cache bash postgresql16-client curl rclone ca-certificates \
  && curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/mc

COPY infrastructure/backup /backup
WORKDIR /backup
RUN chmod +x *.sh targets/*.sh 2>/dev/null || true

ENTRYPOINT ["/bin/bash"]
CMD ["/backup/backup.sh"]
