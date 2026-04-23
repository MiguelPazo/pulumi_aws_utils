# @miguelpazo/pulumi_aws_toolkit

![](https://img.shields.io/badge/LastVersion-v1.0.2-green.svg)
![](https://img.shields.io/badge/Status-Stable-green.svg)
![](https://img.shields.io/badge/Pulumi-3.213%2B-8A3391.svg)
![](https://img.shields.io/badge/AWS-Provider%207.15%2B-FF9900.svg)
![](https://img.shields.io/badge/Node-%3E%3D22.14-339933.svg)
![](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)
![](https://img.shields.io/badge/License-MIT-blue.svg)

A TypeScript library of reusable [Pulumi](https://www.pulumi.com/) modules for AWS infrastructure. It packages opinionated, production-oriented building blocks (networking, compute, data, security, observability, and multi-region failover) so they can be consumed from any Pulumi TypeScript project.

This library is intended to be used **as a dependency** — it is not a deployable Pulumi project on its own.

## Requirements

- Node.js `>= 22.14.0`
- npm `>= 10.9.2`
- A Pulumi TypeScript project that provides the following peer dependencies:
    - `@pulumi/pulumi` `^3.213.0`
    - `@pulumi/aws` `^7.15.0`
    - `@pulumi/awsx` `^3.1.0`

## Installation

```bash
npm install @miguelpazo/pulumi_aws_toolkit
```

Pulumi peer dependencies must already exist in the consuming project.

## Quick Start

Initialize the global config **once**, then use any module or tool.

```typescript
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
    AwsUtilsInit,
    AwsUtilsModules,
    AwsUtilsTools,
    AwsUtilsCommon,
} from "@miguelpazo/pulumi_aws_toolkit";

const providerVirginia = new aws.Provider("provider-virginia", {region: "us-east-1"});

AwsUtilsInit.init({
    project: "myapp",
    stack: pulumi.getStack(),
    stackAlias: "dev",
    accountId: aws.getCallerIdentity().then(id => id.accountId),
    generalPrefix: "myapp-dev",
    generalPrefixShort: "myapp",
    generalPrefixShort2: "ma",
    generalTags: {Project: "myapp", Environment: "dev"},
    region: "us-east-1",
    providerVirginia,
    cloudwatchRetentionLogs: 30,
    deleteProtection: false,
});

// Use any module
const rds = await AwsUtilsModules.Rds.getInstance().main({
    // ...module-specific config
});

// Use any tool (Lambda-based utility)
const alarms = await AwsUtilsTools.LambdaAlarms.getInstance().main({
    // ...tool-specific config
});
```

> `providerVirginia` is always required, even for non-`us-east-1` stacks, because CloudFront and certain ACM operations must run in `us-east-1`.

## Public API

The package exposes four named export groups plus all public types and enums.

### `AwsUtilsInit`

- `init(config: InitConfig)` — must be called before any module or tool is used.

### `AwsUtilsCommon`

Static utility classes (not singletons):

- `General` — Handlebars template rendering, zipping helpers, misc helpers.
- `UtilsInfra` — DNS, ACM certificates, and security group helpers.

### `AwsUtilsModules`

Singleton AWS service modules. Each exposes `getInstance().main(config)` returning a `Promise`.

| Category      | Modules                                                                                                                                               |
|---------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| Networking    | `Alb`, `AlbListener`, `NlbListener`, `ApiGateway`, `ApiGatewayVpcLink`, `CloudFrontBackend`, `CloudFrontFrontend`, `CloudMap`, `Route53`, `VpcImport` |
| Compute       | `EcsCluster`, `EcsService`, `Ecr`, `LambdaRole`, `StepFunctionFailover`                                                                               |
| Data          | `Rds`, `RdsAurora`, `RdsAuroraGlobal`, `RdsProxy`, `DynamoDb`, `ElastiCache`, `Efs`, `S3`, `S3Replica`, `Backup`, `ExportFinalBackup`                 |
| Security      | `Kms`, `Secrets`, `ParamStore`, `Ssm`, `SSMAssociations`                                                                                              |
| Observability | `Alarms`, `AlarmsAdmin`, `AlarmsCIS`, `AlarmsGuardDuty`, `AlarmsInspector`, `AlarmsSecurityHub`, `CloudWatch`                                         |
| Messaging     | `Sqs`, `Ses`                                                                                                                                          |

### `AwsUtilsTools`

Self-contained Lambda deployers (IAM role + log group + function, bundled source):

- `LambdaAlarms` — CloudWatch alarm notification router.
- `LambdaNotifications` — generic event notifier.
- `LambdaRestart` — scheduled ECS / cache restart utility.
- `LambdaExportBackup` — AWS Backup export pipeline.
- `LambdaFailover` — multi-region failover orchestration.
- `UserProwler` — Prowler security scanner IAM user.

## Architecture Highlights

- **Global config singleton.** `AwsUtilsInit.init()` sets a project-wide `InitConfig`; every module retrieves it via `getInit()`. Call it once, before any module.
- **Singleton module pattern.** Every module and tool is accessed through `ModuleName.getInstance().main(config)`.
- **Naming conventions.**
    - Pulumi logical names use `${project}-${service}-${resourceType}`.
    - AWS physical names use `${generalPrefix}-${service}-${resourceType}` (or `generalPrefixShort` for Lambda, `generalPrefixShort2` when ALB/TG names exceed 32 chars).
    - Tags always include `generalTags` plus a `Name` tag matching the physical name.
- **Multi-region / failover.** A single codebase supports both primary and replica stacks. When `multiRegion` and `failoverReplica` are both enabled, modules **import** existing replica resources instead of creating them.
- **Handlebars-templated policies.** IAM policies, S3 replication rules, SSM documents, and parameter configs live in `src/resources/` as Handlebars JSON templates, rendered via `General.renderTemplate()` with project/account/region context.

## Build

```bash
npm run build   # compiles TypeScript to bin/
```

The package's `main` entry points at `index.ts` (source), so consumers compile against the TypeScript source directly. There are no test or lint scripts.

## License

MIT © [Miguel Pazo](https://miguelpazo.com)
