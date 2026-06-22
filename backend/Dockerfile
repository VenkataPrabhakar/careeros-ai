FROM gradle:8.14.5-jdk21 AS builder

WORKDIR /workspace
COPY . /workspace
RUN gradle clean bootJar --no-daemon

FROM eclipse-temurin:21-jre

WORKDIR /app
COPY --from=builder /workspace/build/libs/*.jar /app/careeros-ai.jar

ENV PORT=8080
ENV SQLITE_DB_PATH=/tmp/careeros-ai.db

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java -jar /app/careeros-ai.jar --server.port=${PORT} --spring.datasource.url=jdbc:sqlite:${SQLITE_DB_PATH}"]
