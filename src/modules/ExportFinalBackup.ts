/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {ExportFinalBackupModuleConfig, ExportFinalBackupResult} from "../types";
import {LambdaExportBackup} from "../tools/LambdaExportBackup";

class ExportFinalBackup {
    private static __instance: ExportFinalBackup;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): ExportFinalBackup {
        if (this.__instance == null) {
            this.__instance = new ExportFinalBackup();
        }

        return this.__instance;
    }

    async main(moduleConfig: ExportFinalBackupModuleConfig): Promise<ExportFinalBackupResult> {
        const {
            s3,
            snsArn,
            cwLogsKmsKey,
            retentionMonths = 12,
            sourceBuckets = []
        } = moduleConfig;

        const accountId = await this.config.accountId;
        const bucketName = s3.apply(b => b.bucket);

        /**
         * Create Unified Lambda Function
         */
        const lambdaExportBackup = await LambdaExportBackup.getInstance().main(
            accountId,
            bucketName,
            snsArn,
            cwLogsKmsKey
        );

        /**
         * S3 Batch Operations Role
         */
        const s3BatchRole = new aws.iam.Role(`${this.config.project}-export-backup-s3batch-role`, {
            name: `${this.config.generalPrefixShort}-export-backup-s3batch-role`,
            assumeRolePolicy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Principal: {
                            Service: "batchoperations.s3.amazonaws.com"
                        },
                        Action: "sts:AssumeRole"
                    }
                ]
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-export-backup-s3batch-role`,
            }
        });

        // S3 Batch policy
        new aws.iam.RolePolicy(`${this.config.project}-export-backup-s3batch-policy`, {
            role: s3BatchRole.id,
            policy: bucketName.apply(bucket => JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Action: [
                            "s3:GetObject",
                            "s3:GetObjectVersion"
                        ],
                        Resource: "*"
                    },
                    {
                        Effect: "Allow",
                        Action: [
                            "s3:PutObject"
                        ],
                        Resource: `arn:aws:s3:::${bucket}/*`
                    }
                ]
            }))
        });

        /**
         * Step Functions State Machine Role
         */
        const stateMachineRole = new aws.iam.Role(`${this.config.project}-export-backup-sfn-role`, {
            name: `${this.config.generalPrefixShort}-export-backup-sfn-role`,
            assumeRolePolicy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Principal: {
                            Service: "states.amazonaws.com"
                        },
                        Action: "sts:AssumeRole"
                    }
                ]
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-export-backup-sfn-role`,
            }
        });

        // Attach policy to invoke lambda
        new aws.iam.RolePolicy(`${this.config.project}-export-backup-sfn-policy`, {
            role: stateMachineRole.id,
            policy: lambdaExportBackup.lambdaFunction.arn.apply(lambdaArn => JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Action: [
                            "lambda:InvokeFunction"
                        ],
                        Resource: lambdaArn
                    }
                ]
            }))
        });

        /**
         * Step Functions State Machine Definition
         */
        const stateMachineDefinition = pulumi.all([
            lambdaExportBackup.lambdaFunction.arn,
            s3BatchRole.arn,
            snsArn,
            bucketName
        ]).apply(([lambdaArn, batchRoleArn, sns, bucket]) => {
            return JSON.stringify({
                Comment: "Export CloudWatch Logs to S3 Backup",
                StartAt: "SendStartNotification",
                States: {
                    SendStartNotification: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "CloudWatch Logs Export Started",
                                message: `CloudWatch Logs export process started. Destination: s3://${bucket}/cloudwatch/`
                            }
                        },
                        ResultPath: "$.notificationResult",
                        Next: "ListLogGroups"
                    },
                    ListLogGroups: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "list"
                            }
                        },
                        ResultPath: "$.listResult",
                        ResultSelector: {
                            "logGroups.$": "$.Payload.logGroups",
                            "totalGroups.$": "$.Payload.totalGroups"
                        },
                        Next: "ProcessLogGroups"
                    },
                    ProcessLogGroups: {
                        Type: "Map",
                        ItemsPath: "$.listResult.logGroups",
                        MaxConcurrency: 1,
                        Iterator: {
                            StartAt: "CreateExportTask",
                            States: {
                                CreateExportTask: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "create",
                                            "logGroupName.$": "$.logGroupName",
                                            bucketName: bucket,
                                            retentionMonths: retentionMonths
                                        }
                                    },
                                    ResultPath: "$.createResult",
                                    ResultSelector: {
                                        "taskId.$": "$.Payload.taskId",
                                        "statusCode.$": "$.Payload.statusCode",
                                        "logGroupName.$": "$.Payload.logGroupName"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 120,
                                            MaxAttempts: 20,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Catch: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            ResultPath: "$.error",
                                            Next: "SendLogGroupNotification"
                                        }
                                    ],
                                    Next: "WaitForExport"
                                },
                                WaitForExport: {
                                    Type: "Wait",
                                    Seconds: 30,
                                    Next: "CheckExportTask"
                                },
                                CheckExportTask: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check",
                                            "taskId.$": "$.createResult.taskId",
                                            "logGroupName.$": "$.createResult.logGroupName"
                                        }
                                    },
                                    ResultPath: "$.checkResult",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "isFailed.$": "$.Payload.isFailed",
                                        "status.$": "$.Payload.status",
                                        "logGroupName.$": "$.Payload.logGroupName"
                                    },
                                    Next: "IsExportComplete"
                                },
                                IsExportComplete: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.checkResult.isComplete",
                                            BooleanEquals: true,
                                            Next: "SendLogGroupNotification"
                                        }
                                    ],
                                    Default: "WaitForExport"
                                },
                                SendLogGroupNotification: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "notify",
                                            snsArn: sns,
                                            subject: "CloudWatch Log Group Exported",
                                            "message.$": "States.Format('Log group {} exported with status: {}', $.checkResult.logGroupName, $.checkResult.status)"
                                        }
                                    },
                                    ResultPath: null,
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.processResult",
                        Next: "SendLogsExportCompleted"
                    },
                    SendLogsExportCompleted: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "CloudWatch Logs Export Completed",
                                "message.$": "States.Format('CloudWatch Logs export process completed. Total log groups processed: {}', $.listResult.totalGroups)"
                            }
                        },
                        ResultPath: null,
                        Next: sourceBuckets.length > 0 ? "PrepareS3BucketCopy" : "SendFinalNotification"
                    },
                    ...(sourceBuckets.length > 0 ? {
                        PrepareS3BucketCopy: {
                            Type: "Pass",
                            Result: sourceBuckets.map(name => ({sourceBucket: name})),
                            ResultPath: "$.bucketsToProcess",
                            Next: "ProcessS3Buckets"
                        },
                        ProcessS3Buckets: {
                            Type: "Map",
                            ItemsPath: "$.bucketsToProcess",
                            MaxConcurrency: 1,
                            Iterator: {
                                StartAt: "CreateBatchJob",
                                States: {
                                    CreateBatchJob: {
                                        Type: "Task",
                                        Resource: "arn:aws:states:::lambda:invoke",
                                        Parameters: {
                                            FunctionName: lambdaArn,
                                            Payload: {
                                                action: "create-batch-job",
                                                "sourceBucket.$": "$.sourceBucket",
                                                destinationBucket: bucket,
                                                accountId: accountId,
                                                roleArn: batchRoleArn
                                            }
                                        },
                                        ResultPath: "$.batchResult",
                                        ResultSelector: {
                                            "jobId.$": "$.Payload.jobId",
                                            "skipped.$": "$.Payload.skipped",
                                            "sourceBucket.$": "$.Payload.sourceBucket"
                                        },
                                        Next: "CheckIfSkipped"
                                    },
                                    CheckIfSkipped: {
                                        Type: "Choice",
                                        Choices: [
                                            {
                                                Variable: "$.batchResult.skipped",
                                                BooleanEquals: true,
                                                Next: "SendBucketNotification"
                                            }
                                        ],
                                        Default: "WaitForBatch"
                                    },
                                    WaitForBatch: {
                                        Type: "Wait",
                                        Seconds: 60,
                                        Next: "CheckBatchJob"
                                    },
                                    CheckBatchJob: {
                                        Type: "Task",
                                        Resource: "arn:aws:states:::lambda:invoke",
                                        Parameters: {
                                            FunctionName: lambdaArn,
                                            Payload: {
                                                action: "check-batch-job",
                                                "jobId.$": "$.batchResult.jobId",
                                                accountId: accountId,
                                                "sourceBucket.$": "$.batchResult.sourceBucket"
                                            }
                                        },
                                        ResultPath: "$.checkBatchResult",
                                        ResultSelector: {
                                            "isComplete.$": "$.Payload.isComplete",
                                            "isFailed.$": "$.Payload.isFailed",
                                            "status.$": "$.Payload.status",
                                            "sourceBucket.$": "$.Payload.sourceBucket"
                                        },
                                        Next: "IsBatchComplete"
                                    },
                                    IsBatchComplete: {
                                        Type: "Choice",
                                        Choices: [
                                            {
                                                Variable: "$.checkBatchResult.isComplete",
                                                BooleanEquals: true,
                                                Next: "SendBucketNotification"
                                            }
                                        ],
                                        Default: "WaitForBatch"
                                    },
                                    SendBucketNotification: {
                                        Type: "Task",
                                        Resource: "arn:aws:states:::lambda:invoke",
                                        Parameters: {
                                            FunctionName: lambdaArn,
                                            Payload: {
                                                action: "notify",
                                                snsArn: sns,
                                                subject: "S3 Bucket Copy Completed",
                                                "message.$": "States.Format('Bucket {} copy completed to s3://${bucket}/buckets/{}/', $.batchResult.sourceBucket, $.batchResult.sourceBucket)"
                                            }
                                        },
                                        ResultPath: null,
                                        End: true
                                    }
                                }
                            },
                            ResultPath: "$.s3CopyResult",
                            Next: "SendFinalNotification"
                        }
                    } : {}),
                    SendFinalNotification: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "Export Final Backup Completed",
                                message: `All export and backup processes completed successfully. CloudWatch Logs exported to s3://${bucket}/cloudwatch/${sourceBuckets.length > 0 ? ` and ${sourceBuckets.length} buckets copied to s3://${bucket}/buckets/` : ''}`
                            }
                        },
                        ResultPath: null,
                        End: true
                    }
                }
            });
        });

        /**
         * Step Functions State Machine
         */
        const stateMachine = new aws.sfn.StateMachine(`${this.config.project}-export-backup-sfn`, {
            name: `${this.config.generalPrefixShort}-export-backup`,
            roleArn: stateMachineRole.arn,
            definition: stateMachineDefinition,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-export-backup-sfn`,
            }
        }, {
            dependsOn: [
                lambdaExportBackup.lambdaFunction
            ]
        });

        return {
            stateMachine,
            stateMachineRole
        } as ExportFinalBackupResult;
    }
}

export {ExportFinalBackup}
