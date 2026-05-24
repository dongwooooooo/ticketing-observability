# Stage 2 concurrency module — capacity probe image
# Build context: /Users/idong-u/d/ticketing/concurrency/build/libs/
# JVM heap is intentionally NOT fixed here — JAVA_OPTS injected per spec at runtime.

FROM eclipse-temurin:25-jre

WORKDIR /app

COPY concurrency-0.0.1-SNAPSHOT.jar /app/app.jar

# JVM picks up cgroups limits since JDK 10+ (UseContainerSupport on by default).
# Heap injected via JAVA_OPTS for per-spec control.
ENV JAVA_OPTS=""

EXPOSE 28081

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
