/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "notify",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: { neon: { package: "@sst-provider/neon", version: "0.13.0" } },
    };
  },
  async run() {
    const myAppProject = new neon.Project('MyAppProject', {
      name: 'my-sst-project',
      pgVersion: 17,
      regionId: 'aws-us-east-1',
      orgId: process.env.NEON_ORG_ID!,
      historyRetentionSeconds: 21600,
    });

    const db = new sst.Linkable('NeonDB', {
      properties: {
        connectionString: myAppProject.connectionUri,
      },
    });

    const api = new sst.aws.Function('MyApi', {
      handler: 'server/functions/index.handler',
      link: [db],
      url: {
        cors: {
          allowOrigins: ['*'],
          allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
          allowHeaders: ['Content-Type'],
        },
      },
    });

    new sst.aws.StaticSite('Frontend', {
      build: {
        command: 'bun run build',
        output: 'dist',
      },
      environment: {
        VITE_API_URL: api.url,
      },
    });
  },
});
