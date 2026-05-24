# Stage 3 queue module — capacity probe image
# Build context: /Users/idong-u/d/ticketing/queue/build/libs/queue-0.0.1-SNAPSHOT.jar
# JVM heap injected per spec via JAVA_OPTS at runtime.
# admit-rate-per-tick injected via QUEUE_ADMIT_RATE_PER_TICK env (default 100 = 1000/s).

FROM eclipse-temurin:25-jre

WORKDIR /app

COPY queue-0.0.1-SNAPSHOT.jar /app/app.jar

ENV JAVA_OPTS=""

EXPOSE 28082

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
