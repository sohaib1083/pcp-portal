# PCP Digital Portal: the whole demo in one container for a Hugging Face Docker Space.
# Nginx (:7860) -> Next.js app (:3150) and Keycloak (:8080); PostgreSQL inside. Data resets to the demo on every start.
# The app ships compiled (bundle/), built by deploy/hf/build.sh; no source code is in this image.
FROM quay.io/keycloak/keycloak:24.0 AS keycloak

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql-15 postgresql-contrib-15 openjdk-17-jre-headless nginx-light ca-certificates curl openssl \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/usr/lib/postgresql/15/bin:${PATH}" \
    NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Karachi \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
COPY --from=keycloak /opt/keycloak /opt/keycloak
COPY bundle /app
# Spaces run as uid 1000: everything that is written at run time belongs to it.
RUN mkdir -p /data && chown -R 1000:1000 /app /opt/keycloak /data /var/lib/nginx /var/log/nginx
USER 1000
WORKDIR /app
# The PCP sign-in theme, then build Keycloak's optimised server once, here, so start-up is quick.
RUN cp -r /app/hf/themes/pcp /opt/keycloak/themes/pcp && /opt/keycloak/bin/kc.sh build --db=postgres --health-enabled=true --http-relative-path=/auth
EXPOSE 7860
CMD ["sh", "/app/hf/start.sh"]
