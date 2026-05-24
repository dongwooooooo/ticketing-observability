# Stage 4 distributed module — capacity probe image
# Build context: /Users/idong-u/d/ticketing/distributed/build/libs/distributed-0.0.1-SNAPSHOT.jar
# INSTANCE_ID injected per replica (app1, app2) to verify cross-instance state in Redis.

FROM eclipse-temurin:25-jre

WORKDIR /app

COPY distributed-0.0.1-SNAPSHOT.jar /app/app.jar

ENV JAVA_OPTS=""

EXPOSE 28083

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
