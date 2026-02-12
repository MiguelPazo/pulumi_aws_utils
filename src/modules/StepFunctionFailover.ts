/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {StepFunctionFailoverModuleConfig, StepFunctionFailoverResult} from "../types";
import {LambdaFailover} from "../tools/LambdaFailover";

class StepFunctionFailover {
    private static __instance: StepFunctionFailover;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): StepFunctionFailover {
        if (this.__instance == null) {
            this.__instance = new StepFunctionFailover();
        }

        return this.__instance;
    }

    async main(moduleConfig: StepFunctionFailoverModuleConfig): Promise<StepFunctionFailoverResult> {
        const {
            parameterStoreConfigPath,
            failoverStatusPath,
            snsArn,
            cwLogsKmsKey,
            lambdaKmsKey,
            enableParamsSecure,
            ssmKmsKey,
            defaultPolicy = true
        } = moduleConfig;

        const accountId = await this.config.accountId;

        /**
         * Create Lambda Function for Failover Operations
         */
        const lambdaFailover = await LambdaFailover.getInstance().main(
            accountId,
            snsArn,
            cwLogsKmsKey,
            lambdaKmsKey,
            enableParamsSecure,
            ssmKmsKey
        );

        /**
         * Step Functions State Machine Role
         */
        const stateMachineRole = new aws.iam.Role(`${this.config.project}-failover-sfn-role`, {
            name: `${this.config.generalPrefixShort}-failover-sfn-role`,
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
                Name: `${this.config.generalPrefixShort}-failover-sfn-role`,
            }
        });

        // Attach policy to invoke lambda and read/write SSM parameters
        if (defaultPolicy) {
            new aws.iam.RolePolicy(`${this.config.project}-failover-sfn-policy`, {
                role: stateMachineRole.id,
                policy: lambdaFailover.lambdaFunction.arn.apply(lambdaArn => JSON.stringify({
                    Version: "2012-10-17",
                    Statement: [
                        {
                            Effect: "Allow",
                            Action: [
                                "lambda:InvokeFunction"
                            ],
                            Resource: lambdaArn
                        },
                        {
                            Effect: "Allow",
                            Action: [
                                "ssm:GetParameter",
                                "ssm:GetParameters"
                            ],
                            Resource: `arn:aws:ssm:${this.config.region}:${accountId}:parameter${parameterStoreConfigPath}`
                        },
                        {
                            Effect: "Allow",
                            Action: [
                                "ssm:PutParameter",
                                "ssm:GetParameter"
                            ],
                            Resource: `arn:aws:ssm:${this.config.region}:${accountId}:parameter${failoverStatusPath}`
                        }
                    ]
                }))
            });
        }

        /**
         * Step Functions State Machine Definition
         */
        const stateMachineDefinition = pulumi.all([
            lambdaFailover.lambdaFunction.arn,
            snsArn
        ]).apply(([lambdaArn, sns]) => {
            // Helper function to create status tracking step
            const createStatusTrackingStep = (stepName: string, nextStep: string) => ({
                Type: "Task",
                Resource: "arn:aws:states:::lambda:invoke",
                Parameters: {
                    FunctionName: lambdaArn,
                    Payload: {
                        action: "update-failover-status",
                        parameterName: failoverStatusPath,
                        "stepName": stepName,
                        "executionArn.$": "$$.Execution.Id"
                    }
                },
                ResultPath: null,
                Catch: [
                    {
                        ErrorEquals: ["States.ALL"],
                        Next: nextStep,
                        ResultPath: "$.statusUpdateError"
                    }
                ],
                Next: nextStep
            });

            return JSON.stringify({
                Comment: "Multi-Region Failover Automation",
                StartAt: "LoadConfiguration",
                States: {
                    LoadConfiguration: {
                        Type: "Task",
                        Resource: "arn:aws:states:::aws-sdk:ssm:getParameter",
                        Parameters: {
                            Name: parameterStoreConfigPath,
                            WithDecryption: true
                        },
                        ResultPath: "$.config",
                        ResultSelector: {
                            "value.$": "States.StringToJson($.Parameter.Value)"
                        },
                        Next: "GetFailoverStatus"
                    },
                    GetFailoverStatus: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "get-failover-status",
                                parameterName: failoverStatusPath
                            }
                        },
                        ResultPath: "$.failoverStatus",
                        ResultSelector: {
                            "status.$": "$.Payload.status",
                            "lastSuccessfulStep.$": "$.Payload.lastSuccessfulStep",
                            "executionArn.$": "$.Payload.executionArn",
                            "timestamp.$": "$.Payload.timestamp"
                        },
                        Catch: [
                            {
                                ErrorEquals: ["States.ALL"],
                                ResultPath: "$.failoverStatusError",
                                Next: "DetermineStartPoint"
                            }
                        ],
                        Next: "DetermineStartPoint"
                    },
                    DetermineStartPoint: {
                        Type: "Choice",
                        Choices: [
                            {
                                Variable: "$.failoverStatus.lastSuccessfulStep",
                                StringEquals: "TrafficStopped",
                                Next: "NotifyResumingFromTrafficStopped"
                            },
                            {
                                Variable: "$.failoverStatus.lastSuccessfulStep",
                                StringEquals: "DataMigrationComplete",
                                Next: "NotifyResumingFromDataMigration"
                            },
                            {
                                Variable: "$.failoverStatus.lastSuccessfulStep",
                                StringEquals: "ServicesRestarted",
                                Next: "NotifyResumingFromServicesRestarted"
                            },
                            {
                                Variable: "$.failoverStatus.lastSuccessfulStep",
                                StringEquals: "CloudFrontEnabled",
                                Next: "NotifyResumingFromCloudFrontEnabled"
                            },
                            {
                                Variable: "$.failoverStatus.lastSuccessfulStep",
                                StringEquals: "FailoverComplete",
                                Next: "NotifyAlreadyCompleted"
                            }
                        ],
                        Default: "SendStartNotification"
                    },
                    NotifyResumingFromTrafficStopped: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "Resuming Failover: From S3 Validation",
                                "message.$": "States.Format('Resuming failover from previous execution. Last successful step: TrafficStopped. Continuing from S3 replication validation. Previous execution: {}', $.failoverStatus.executionArn)"
                            }
                        },
                        ResultPath: null,
                        Next: "ValidateS3Replication"
                    },
                    NotifyResumingFromDataMigration: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "Resuming Failover: From ECS Services",
                                "message.$": "States.Format('Resuming failover from previous execution. Last successful step: DataMigrationComplete. Continuing from ECS services management. Previous execution: {}', $.failoverStatus.executionArn)"
                            }
                        },
                        ResultPath: null,
                        Next: "CheckIfEcsServicesExist"
                    },
                    NotifyResumingFromServicesRestarted: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "Resuming Failover: From EventBridge Rules",
                                "message.$": "States.Format('Resuming failover from previous execution. Last successful step: ServicesRestarted. Continuing from EventBridge rules management. Previous execution: {}', $.failoverStatus.executionArn)"
                            }
                        },
                        ResultPath: null,
                        Next: "CheckIfEventBridgeRulesExist"
                    },
                    NotifyResumingFromCloudFrontEnabled: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "Resuming Failover: From Frontend CloudFront Disable",
                                "message.$": "States.Format('Resuming failover from previous execution. Last successful step: CloudFrontEnabled. Continuing to disable primary frontend CloudFront distributions. Previous execution: {}', $.failoverStatus.executionArn)"
                            }
                        },
                        ResultPath: null,
                        Next: "DisablePrimaryFrontendCloudFront"
                    },
                    NotifyAlreadyCompleted: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "Failover Already Completed",
                                "message.$": "States.Format('Failover process was already completed in previous execution: {}. Last completion timestamp: {}', $.failoverStatus.executionArn, $.failoverStatus.timestamp)"
                            }
                        },
                        ResultPath: null,
                        End: true
                    },
                    SendStartNotification: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "Multi-Region Failover Started",
                                message: "Multi-region failover process has been initiated. Starting infrastructure migration."
                            }
                        },
                        ResultPath: null,
                        Next: "DisablePrimaryCloudFront"
                    },

                    // Step 1: CRITICAL - Disable Primary CloudFront Backend to stop traffic
                    DisablePrimaryCloudFront: {
                        Type: "Map",
                        ItemsPath: "$.config.value.cloudFront",
                        MaxConcurrency: 3,
                        Iterator: {
                            StartAt: "CheckIfShouldDisable",
                            States: {
                                CheckIfShouldDisable: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            And: [
                                                {
                                                    Variable: "$.shouldDisable",
                                                    BooleanEquals: true
                                                },
                                                {
                                                    Variable: "$.type",
                                                    StringEquals: "backend"
                                                }
                                            ],
                                            Next: "RemoveAliasesPhase1"
                                        }
                                    ],
                                    Default: "SkipDisable"
                                },
                                RemoveAliasesPhase1: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            And: [
                                                {
                                                    Variable: "$.aliasesToRemove",
                                                    IsPresent: true
                                                },
                                                {
                                                    Variable: "$.aliasesToRemove[0]",
                                                    IsPresent: true
                                                }
                                            ],
                                            Next: "RemoveAliases"
                                        }
                                    ],
                                    Default: "DisableDistribution"
                                },
                                RemoveAliases: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "remove-cloudfront-alias",
                                            "distributionId.$": "$.distributionId",
                                            "aliasesToRemove.$": "$.aliasesToRemove"
                                        }
                                    },
                                    ResultPath: "$.removeResult",
                                    ResultSelector: {
                                        "distributionId.$": "$.Payload.distributionId",
                                        "status.$": "$.Payload.status"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 20,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "WaitAfterRemove"
                                },
                                WaitAfterRemove: {
                                    Type: "Wait",
                                    Seconds: 60,
                                    Next: "CheckRemoveDeployment"
                                },
                                CheckRemoveDeployment: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check-cloudfront-deployment",
                                            "distributionId.$": "$.removeResult.distributionId"
                                        }
                                    },
                                    ResultPath: "$.deploymentCheck",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "status.$": "$.Payload.status"
                                    },
                                    Next: "IsRemoveDeploymentComplete"
                                },
                                IsRemoveDeploymentComplete: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.deploymentCheck.isComplete",
                                            BooleanEquals: true,
                                            Next: "DisableDistribution"
                                        }
                                    ],
                                    Default: "WaitAfterRemove"
                                },
                                DisableDistribution: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "disable-cloudfront",
                                            "distributionId.$": "$.distributionId"
                                        }
                                    },
                                    ResultPath: "$.disableResult",
                                    ResultSelector: {
                                        "distributionId.$": "$.Payload.distributionId",
                                        "status.$": "$.Payload.status"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 20,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "WaitAfterDisable"
                                },
                                WaitAfterDisable: {
                                    Type: "Wait",
                                    Seconds: 60,
                                    Next: "CheckDisableDeployment"
                                },
                                CheckDisableDeployment: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check-cloudfront-deployment",
                                            "distributionId.$": "$.disableResult.distributionId"
                                        }
                                    },
                                    ResultPath: "$.deploymentCheck",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "status.$": "$.Payload.status"
                                    },
                                    Next: "IsDisableDeploymentComplete"
                                },
                                IsDisableDeploymentComplete: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.deploymentCheck.isComplete",
                                            BooleanEquals: true,
                                            Next: "DisableComplete"
                                        }
                                    ],
                                    Default: "WaitAfterDisable"
                                },
                                SkipDisable: {
                                    Type: "Pass",
                                    Result: {
                                        skipped: true
                                    },
                                    End: true
                                },
                                DisableComplete: {
                                    Type: "Pass",
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.disablePrimaryResults",
                        Next: "NotifyTrafficStopped"
                    },
                    NotifyTrafficStopped: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "CRITICAL: Primary Backend CloudFront STOPPED",
                                message: "Primary backend CloudFront distributions have been disabled. Backend traffic has been stopped to prevent data inconsistency during failover. Frontend distributions remain active."
                            }
                        },
                        ResultPath: null,
                        Next: "TrackTrafficStopped"
                    },
                    TrackTrafficStopped: createStatusTrackingStep("TrafficStopped", "ValidateS3Replication"),

                    // Step 2: Validate S3 Replication
                    ValidateS3Replication: {
                        Type: "Map",
                        ItemsPath: "$.config.value.s3Buckets",
                        MaxConcurrency: 3,
                        Parameters: {
                            "bucket.$": "$$.Map.Item.Value",
                            "primaryRegion.$": "$.config.value.primaryRegion"
                        },
                        Iterator: {
                            StartAt: "CheckS3Bucket",
                            States: {
                                CheckS3Bucket: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check-s3-replication",
                                            "bucket.$": "$.bucket",
                                            "primaryRegion.$": "$.primaryRegion"
                                        }
                                    },
                                    ResultPath: "$.replicationCheck",
                                    ResultSelector: {
                                        "bucketName.$": "$.Payload.bucketName",
                                        "bucketRegion.$": "$.Payload.bucketRegion",
                                        "isSynced.$": "$.Payload.isSynced",
                                        "latency.$": "$.Payload.latency"
                                    },
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.s3ValidationResults",
                        Next: "NotifyS3ValidationComplete"
                    },
                    NotifyS3ValidationComplete: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "S3 Replication Validated",
                                "message.$": "States.Format('All S3 buckets validated. Total buckets: {}', States.ArrayLength($.s3ValidationResults))"
                            }
                        },
                        ResultPath: null,
                        Next: "CheckIfRDSExists"
                    },

                    // Check if RDS configuration exists
                    CheckIfRDSExists: {
                        Type: "Choice",
                        Choices: [
                            {
                                Variable: "$.config.value.rds",
                                IsPresent: true,
                                Next: "PromoteRDSCluster"
                            }
                        ],
                        Default: "SkipRDSPromotion"
                    },

                    SkipRDSPromotion: {
                        Type: "Pass",
                        Result: {
                            skipped: true,
                            message: "RDS configuration not found, skipping RDS promotion"
                        },
                        ResultPath: "$.rdsPromotionResult",
                        Next: "DisableEFSReplication"
                    },

                    // Step 3: Promote RDS Aurora Global Cluster
                    PromoteRDSCluster: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "promote-rds-cluster",
                                "globalClusterId.$": "$.config.value.rds.globalClusterId",
                                "secondaryClusterArn.$": "$.config.value.rds.secondaryClusterArn",
                                "secondaryRegion.$": "$.config.value.rds.secondaryClusterRegion"
                            }
                        },
                        ResultPath: "$.rdsPromotionResult",
                        ResultSelector: {
                            "statusCode.$": "$.Payload.statusCode",
                            "globalClusterId.$": "$.Payload.globalClusterId",
                            "secondaryClusterArn.$": "$.Payload.secondaryClusterArn",
                            "status.$": "$.Payload.status"
                        },
                        Retry: [
                            {
                                ErrorEquals: ["States.ALL"],
                                IntervalSeconds: 30,
                                MaxAttempts: 3,
                                BackoffRate: 2.0
                            }
                        ],
                        Next: "WaitForRDSPromotion"
                    },
                    WaitForRDSPromotion: {
                        Type: "Wait",
                        Seconds: 60,
                        Next: "CheckRDSPromotion"
                    },
                    CheckRDSPromotion: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "check-rds-promotion",
                                "secondaryClusterArn.$": "$.rdsPromotionResult.secondaryClusterArn",
                                "secondaryRegion.$": "$.config.value.rds.secondaryClusterRegion"
                            }
                        },
                        ResultPath: "$.rdsCheckResult",
                        ResultSelector: {
                            "isComplete.$": "$.Payload.isComplete",
                            "isFailed.$": "$.Payload.isFailed",
                            "status.$": "$.Payload.status",
                            "clusterArn.$": "$.Payload.clusterArn"
                        },
                        Next: "IsRDSPromotionComplete"
                    },
                    IsRDSPromotionComplete: {
                        Type: "Choice",
                        Choices: [
                            {
                                Variable: "$.rdsCheckResult.isComplete",
                                BooleanEquals: true,
                                Next: "NotifyRDSComplete"
                            },
                            {
                                Variable: "$.rdsCheckResult.isFailed",
                                BooleanEquals: true,
                                Next: "NotifyRDSFailed"
                            }
                        ],
                        Default: "WaitForRDSPromotion"
                    },
                    NotifyRDSComplete: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "RDS Aurora Cluster Promoted",
                                "message.$": "States.Format('RDS Aurora cluster {} has been successfully promoted to primary in region {}', $.rdsCheckResult.clusterArn, $.config.value.rds.secondaryClusterRegion)"
                            }
                        },
                        ResultPath: null,
                        Next: "DisableEFSReplication"
                    },
                    NotifyRDSFailed: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "RDS Promotion FAILED",
                                "message.$": "States.Format('CRITICAL: RDS cluster {} promotion failed with status: {}', $.rdsCheckResult.clusterArn, $.rdsCheckResult.status)"
                            }
                        },
                        ResultPath: null,
                        Next: "FailoverFailed"
                    },

                    // Step 4: Disable EFS Replication and Promote Replicas
                    DisableEFSReplication: {
                        Type: "Map",
                        ItemsPath: "$.config.value.efs",
                        MaxConcurrency: 2,
                        Parameters: {
                            "efsItem.$": "$$.Map.Item.Value",
                            "primaryRegion.$": "$.config.value.primaryRegion"
                        },
                        Iterator: {
                            StartAt: "DisableEFS",
                            States: {
                                DisableEFS: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "disable-efs-replication",
                                            "sourceFileSystemId.$": "$.efsItem.sourceFileSystemId",
                                            "primaryRegion.$": "$.primaryRegion"
                                        }
                                    },
                                    ResultPath: "$.disableResult",
                                    ResultSelector: {
                                        "statusCode.$": "$.Payload.statusCode",
                                        "sourceFileSystemId.$": "$.Payload.sourceFileSystemId",
                                        "primaryRegion.$": "$.Payload.primaryRegion",
                                        "destinationFileSystemId.$": "$.Payload.destinationFileSystemId",
                                        "destinationRegion.$": "$.Payload.destinationRegion",
                                        "status.$": "$.Payload.status"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 15,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "WaitForEFS"
                                },
                                WaitForEFS: {
                                    Type: "Wait",
                                    Seconds: 30,
                                    Next: "CheckEFS"
                                },
                                CheckEFS: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check-efs-status",
                                            "sourceFileSystemId.$": "$.disableResult.sourceFileSystemId",
                                            "primaryRegion.$": "$.disableResult.primaryRegion"
                                        }
                                    },
                                    ResultPath: "$.efsCheckResult",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "status.$": "$.Payload.status",
                                        "sourceFileSystemId.$": "$.Payload.sourceFileSystemId"
                                    },
                                    Next: "IsEFSReady"
                                },
                                IsEFSReady: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.efsCheckResult.isComplete",
                                            BooleanEquals: true,
                                            Next: "EFSComplete"
                                        }
                                    ],
                                    Default: "WaitForEFS"
                                },
                                EFSComplete: {
                                    Type: "Pass",
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.efsResults",
                        Next: "NotifyEFSComplete"
                    },
                    NotifyEFSComplete: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "EFS Replication Disabled",
                                "message.$": "States.Format('All EFS replicas promoted. Total EFS systems: {}', States.ArrayLength($.efsResults))"
                            }
                        },
                        ResultPath: null,
                        Next: "TrackDataMigrationComplete"
                    },
                    TrackDataMigrationComplete: createStatusTrackingStep("DataMigrationComplete", "CheckIfEcsServicesExist"),

                    // Check if ECS Services array has elements
                    CheckIfEcsServicesExist: {
                        Type: "Choice",
                        Choices: [
                            {
                                Variable: "$.config.value.ecsServices[0]",
                                IsPresent: true,
                                Next: "ManageEcsServices"
                            }
                        ],
                        Default: "SkipEcsServices"
                    },

                    SkipEcsServices: {
                        Type: "Pass",
                        Result: {
                            skipped: true,
                            message: "ECS Services configuration not found, skipping ECS service management"
                        },
                        ResultPath: "$.ecsResults",
                        Next: "CheckIfEventBridgeRulesExist"
                    },

                    // Step 5: Manage ECS Services (restart or update based on forceUpdate flag)
                    ManageEcsServices: {
                        Type: "Map",
                        ItemsPath: "$.config.value.ecsServices",
                        MaxConcurrency: 3,
                        Parameters: {
                            "service.$": "$$.Map.Item.Value",
                            "secondaryRegion.$": "$.config.value.secondaryRegion"
                        },
                        Iterator: {
                            StartAt: "ManageService",
                            States: {
                                ManageService: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "manage-ecs-service",
                                            "service.$": "$.service",
                                            "secondaryRegion.$": "$.secondaryRegion"
                                        }
                                    },
                                    ResultPath: "$.manageResult",
                                    ResultSelector: {
                                        "clusterName.$": "$.Payload.clusterName",
                                        "serviceName.$": "$.Payload.serviceName",
                                        "taskDefinition.$": "$.Payload.taskDefinition",
                                        "desiredCount.$": "$.Payload.desiredCount",
                                        "deploymentId.$": "$.Payload.deploymentId",
                                        "status.$": "$.Payload.status",
                                        "ecsRegion.$": "$.Payload.ecsRegion"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 15,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "WaitForDeployment"
                                },
                                WaitForDeployment: {
                                    Type: "Wait",
                                    Seconds: 30,
                                    Next: "CheckDeployment"
                                },
                                CheckDeployment: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check-ecs-deployment",
                                            "clusterName.$": "$.manageResult.clusterName",
                                            "serviceName.$": "$.manageResult.serviceName",
                                            "deploymentId.$": "$.manageResult.deploymentId",
                                            "ecsRegion.$": "$.manageResult.ecsRegion"
                                        }
                                    },
                                    ResultPath: "$.deploymentCheckResult",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "isFailed.$": "$.Payload.isFailed",
                                        "status.$": "$.Payload.status",
                                        "runningCount.$": "$.Payload.runningCount",
                                        "desiredCount.$": "$.Payload.desiredCount"
                                    },
                                    Next: "IsDeploymentComplete"
                                },
                                IsDeploymentComplete: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.deploymentCheckResult.isComplete",
                                            BooleanEquals: true,
                                            Next: "ManageComplete"
                                        },
                                        {
                                            Variable: "$.deploymentCheckResult.isFailed",
                                            BooleanEquals: true,
                                            Next: "ManageFailed"
                                        }
                                    ],
                                    Default: "WaitForDeployment"
                                },
                                ManageFailed: {
                                    Type: "Fail",
                                    Error: "EcsServiceManagementFailed",
                                    Cause: "ECS service management deployment failed"
                                },
                                ManageComplete: {
                                    Type: "Pass",
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.ecsResults",
                        Next: "NotifyEcsComplete"
                    },
                    NotifyEcsComplete: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "ECS Services Managed",
                                "message.$": "States.Format('All ECS services have been successfully managed. Total services: {}', States.ArrayLength($.ecsResults))"
                            }
                        },
                        ResultPath: null,
                        Next: "TrackServicesRestarted"
                    },
                    TrackServicesRestarted: createStatusTrackingStep("ServicesRestarted", "CheckIfEventBridgeRulesExist"),

                    // Check if EventBridge rules configuration exists
                    CheckIfEventBridgeRulesExist: {
                        Type: "Choice",
                        Choices: [
                            {
                                Variable: "$.config.value.eventBridgeRules",
                                IsPresent: true,
                                Next: "DisableEventBridgeRules"
                            }
                        ],
                        Default: "SkipEventBridgeRules"
                    },

                    SkipEventBridgeRules: {
                        Type: "Pass",
                        Result: {
                            skipped: true,
                            message: "EventBridge rules configuration not found, skipping EventBridge management"
                        },
                        ResultPath: "$.eventBridgeDisableResults",
                        Next: "UnlinkAliasRecords"
                    },

                    // Step 6a: Disable EventBridge Rules (disable primary region rules first)
                    DisableEventBridgeRules: {
                        Type: "Map",
                        ItemsPath: "$.config.value.eventBridgeRules",
                        MaxConcurrency: 5,
                        Iterator: {
                            StartAt: "CheckIfShouldDisableEBRule",
                            States: {
                                CheckIfShouldDisableEBRule: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.shouldDisable",
                                            BooleanEquals: true,
                                            Next: "DisableEBRule"
                                        }
                                    ],
                                    Default: "SkipDisableEBRule"
                                },
                                DisableEBRule: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "disable-eventbridge-rule",
                                            "ruleName.$": "$.ruleName",
                                            "region.$": "$.region"
                                        }
                                    },
                                    ResultPath: "$.ruleResult",
                                    ResultSelector: {
                                        "ruleName.$": "$.Payload.ruleName",
                                        "region.$": "$.Payload.region",
                                        "state.$": "$.Payload.state",
                                        "status.$": "$.Payload.status"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 10,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    End: true
                                },
                                SkipDisableEBRule: {
                                    Type: "Pass",
                                    Result: {
                                        skipped: true
                                    },
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.eventBridgeDisableResults",
                        Next: "NotifyEventBridgeDisabled"
                    },
                    NotifyEventBridgeDisabled: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "EventBridge Rules Disabled",
                                "message.$": "States.Format('Primary region EventBridge rules have been disabled. Total rules processed: {}', States.ArrayLength($.eventBridgeDisableResults))"
                            }
                        },
                        ResultPath: null,
                        Next: "EnableEventBridgeRules"
                    },

                    // Step 6b: Enable EventBridge Rules (enable secondary region rules)
                    EnableEventBridgeRules: {
                        Type: "Map",
                        ItemsPath: "$.config.value.eventBridgeRules",
                        MaxConcurrency: 5,
                        Iterator: {
                            StartAt: "CheckIfShouldEnableEBRule",
                            States: {
                                CheckIfShouldEnableEBRule: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.shouldEnable",
                                            BooleanEquals: true,
                                            Next: "EnableEBRule"
                                        }
                                    ],
                                    Default: "SkipEnableEBRule"
                                },
                                EnableEBRule: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "enable-eventbridge-rule",
                                            "ruleName.$": "$.ruleName",
                                            "region.$": "$.region"
                                        }
                                    },
                                    ResultPath: "$.ruleResult",
                                    ResultSelector: {
                                        "ruleName.$": "$.Payload.ruleName",
                                        "region.$": "$.Payload.region",
                                        "state.$": "$.Payload.state",
                                        "status.$": "$.Payload.status"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 10,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    End: true
                                },
                                SkipEnableEBRule: {
                                    Type: "Pass",
                                    Result: {
                                        skipped: true
                                    },
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.eventBridgeEnableResults",
                        Next: "NotifyEventBridgeEnabled"
                    },
                    NotifyEventBridgeEnabled: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "EventBridge Rules Enabled",
                                "message.$": "States.Format('Secondary region EventBridge rules have been enabled. Total rules processed: {}', States.ArrayLength($.eventBridgeEnableResults))"
                            }
                        },
                        ResultPath: null,
                        Next: "UnlinkAliasRecords"
                    },

                    // Step 6c: Unlink Route53 Alias Records from distributions to be disabled
                    UnlinkAliasRecords: {
                        Type: "Map",
                        ItemsPath: "$.config.value.cloudFront",
                        MaxConcurrency: 3,
                        Iterator: {
                            StartAt: "CheckIfShouldUnlink",
                            States: {
                                CheckIfShouldUnlink: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            And: [
                                                {
                                                    Variable: "$.shouldDisable",
                                                    BooleanEquals: true
                                                },
                                                {
                                                    Variable: "$.aliasesToRemove",
                                                    IsPresent: true
                                                },
                                                {
                                                    Variable: "$.aliasesToRemove[0]",
                                                    IsPresent: true
                                                }
                                            ],
                                            Next: "UnlinkDNSRecords"
                                        }
                                    ],
                                    Default: "SkipUnlink"
                                },
                                UnlinkDNSRecords: {
                                    Type: "Map",
                                    ItemsPath: "$.aliasesToRemove",
                                    MaxConcurrency: 2,
                                    Parameters: {
                                        "aliasName.$": "$$.Map.Item.Value",
                                        "hostedZoneId.$": "$.hostedZoneId"
                                    },
                                    Iterator: {
                                        StartAt: "UnlinkAlias",
                                        States: {
                                            UnlinkAlias: {
                                                Type: "Task",
                                                Resource: "arn:aws:states:::lambda:invoke",
                                                Parameters: {
                                                    FunctionName: lambdaArn,
                                                    Payload: {
                                                        action: "unlink-route53-alias",
                                                        "hostedZoneId.$": "$.hostedZoneId",
                                                        "aliasName.$": "$.aliasName"
                                                    }
                                                },
                                                ResultPath: "$.unlinkResult",
                                                ResultSelector: {
                                                    "aliasName.$": "$.Payload.aliasName",
                                                    "changeId.$": "$.Payload.changeId",
                                                    "status.$": "$.Payload.status"
                                                },
                                                Retry: [
                                                    {
                                                        ErrorEquals: ["States.ALL"],
                                                        IntervalSeconds: 10,
                                                        MaxAttempts: 3,
                                                        BackoffRate: 1.5
                                                    }
                                                ],
                                                Next: "WaitForUnlink"
                                            },
                                            WaitForUnlink: {
                                                Type: "Wait",
                                                Seconds: 15,
                                                Next: "CheckUnlinkStatus"
                                            },
                                            CheckUnlinkStatus: {
                                                Type: "Task",
                                                Resource: "arn:aws:states:::lambda:invoke",
                                                Parameters: {
                                                    FunctionName: lambdaArn,
                                                    Payload: {
                                                        action: "check-route53",
                                                        "changeId.$": "$.unlinkResult.changeId"
                                                    }
                                                },
                                                ResultPath: "$.checkResult",
                                                ResultSelector: {
                                                    "isComplete.$": "$.Payload.isComplete",
                                                    "status.$": "$.Payload.status"
                                                },
                                                Next: "IsUnlinkComplete"
                                            },
                                            IsUnlinkComplete: {
                                                Type: "Choice",
                                                Choices: [
                                                    {
                                                        Variable: "$.checkResult.isComplete",
                                                        BooleanEquals: true,
                                                        Next: "UnlinkDone"
                                                    }
                                                ],
                                                Default: "WaitForUnlink"
                                            },
                                            UnlinkDone: {
                                                Type: "Pass",
                                                End: true
                                            }
                                        }
                                    },
                                    ResultPath: "$.unlinkResults",
                                    Next: "RemoveAliasesFromCloudFront"
                                },
                                RemoveAliasesFromCloudFront: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "remove-cloudfront-alias",
                                            "distributionId.$": "$.distributionId",
                                            "aliasesToRemove.$": "$.aliasesToRemove"
                                        }
                                    },
                                    ResultPath: "$.removeResult",
                                    ResultSelector: {
                                        "distributionId.$": "$.Payload.distributionId",
                                        "status.$": "$.Payload.status"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 20,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "WaitForUnlinkDeployment"
                                },
                                WaitForUnlinkDeployment: {
                                    Type: "Wait",
                                    Seconds: 60,
                                    Next: "CheckUnlinkDeployment"
                                },
                                CheckUnlinkDeployment: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check-cloudfront-deployment",
                                            "distributionId.$": "$.removeResult.distributionId"
                                        }
                                    },
                                    ResultPath: "$.deploymentCheck",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "status.$": "$.Payload.status"
                                    },
                                    Next: "IsUnlinkDeploymentComplete"
                                },
                                IsUnlinkDeploymentComplete: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.deploymentCheck.isComplete",
                                            BooleanEquals: true,
                                            Next: "UnlinkComplete"
                                        }
                                    ],
                                    Default: "WaitForUnlinkDeployment"
                                },
                                SkipUnlink: {
                                    Type: "Pass",
                                    Result: {
                                        skipped: true
                                    },
                                    End: true
                                },
                                UnlinkComplete: {
                                    Type: "Pass",
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.unlinkAliasResults",
                        Next: "NotifyAliasesUnlinked"
                    },
                    NotifyAliasesUnlinked: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "Route53 Aliases Unlinked",
                                message: "Route53 aliases have been removed from distributions to be disabled."
                            }
                        },
                        ResultPath: null,
                        Next: "EnableSecondaryCloudFront"
                    },

                    // Step 7: Enable Secondary CloudFront to restore traffic
                    EnableSecondaryCloudFront: {
                        Type: "Map",
                        ItemsPath: "$.config.value.cloudFront",
                        MaxConcurrency: 3,
                        Iterator: {
                            StartAt: "CheckIfShouldEnable",
                            States: {
                                CheckIfShouldEnable: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.shouldEnable",
                                            BooleanEquals: true,
                                            Next: "EnableDistribution"
                                        }
                                    ],
                                    Default: "SkipEnable"
                                },
                                EnableDistribution: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "enable-cloudfront",
                                            "distributionId.$": "$.distributionId"
                                        }
                                    },
                                    ResultPath: "$.enableResult",
                                    ResultSelector: {
                                        "distributionId.$": "$.Payload.distributionId",
                                        "status.$": "$.Payload.status"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 20,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "WaitAfterEnable"
                                },
                                WaitAfterEnable: {
                                    Type: "Wait",
                                    Seconds: 60,
                                    Next: "CheckEnableDeployment"
                                },
                                CheckEnableDeployment: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check-cloudfront-deployment",
                                            "distributionId.$": "$.enableResult.distributionId"
                                        }
                                    },
                                    ResultPath: "$.deploymentCheck",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "status.$": "$.Payload.status"
                                    },
                                    Next: "IsEnableDeploymentComplete"
                                },
                                IsEnableDeploymentComplete: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.deploymentCheck.isComplete",
                                            BooleanEquals: true,
                                            Next: "AddAliasesPhase2"
                                        }
                                    ],
                                    Default: "WaitAfterEnable"
                                },
                                AddAliasesPhase2: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            And: [
                                                {
                                                    Variable: "$.aliasesToAdd",
                                                    IsPresent: true
                                                },
                                                {
                                                    Variable: "$.aliasesToAdd[0]",
                                                    IsPresent: true
                                                }
                                            ],
                                            Next: "AddAliases"
                                        }
                                    ],
                                    Default: "EnableComplete"
                                },
                                AddAliases: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "add-cloudfront-alias",
                                            "distributionId.$": "$.distributionId",
                                            "aliasesToAdd.$": "$.aliasesToAdd"
                                        }
                                    },
                                    ResultPath: "$.addResult",
                                    ResultSelector: {
                                        "distributionId.$": "$.Payload.distributionId",
                                        "status.$": "$.Payload.status"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 20,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "WaitAfterAddAliases"
                                },
                                WaitAfterAddAliases: {
                                    Type: "Wait",
                                    Seconds: 60,
                                    Next: "CheckAddAliasesDeployment"
                                },
                                CheckAddAliasesDeployment: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check-cloudfront-deployment",
                                            "distributionId.$": "$.addResult.distributionId"
                                        }
                                    },
                                    ResultPath: "$.deploymentCheck",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "status.$": "$.Payload.status"
                                    },
                                    Next: "IsAddAliasesDeploymentComplete"
                                },
                                IsAddAliasesDeploymentComplete: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.deploymentCheck.isComplete",
                                            BooleanEquals: true,
                                            Next: "GetCloudFrontDNS"
                                        }
                                    ],
                                    Default: "WaitAfterAddAliases"
                                },
                                GetCloudFrontDNS: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "get-cloudfront-dns",
                                            "distributionId.$": "$.distributionId"
                                        }
                                    },
                                    ResultPath: "$.distributionDns",
                                    ResultSelector: {
                                        "dnsName.$": "$.Payload.dnsName",
                                        "distributionId.$": "$.Payload.distributionId"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 10,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "LinkDNSRecords"
                                },
                                LinkDNSRecords: {
                                    Type: "Map",
                                    ItemsPath: "$.aliasesToAdd",
                                    MaxConcurrency: 2,
                                    Parameters: {
                                        "aliasName.$": "$$.Map.Item.Value",
                                        "hostedZoneId.$": "$.hostedZoneId",
                                        "distributionDnsName.$": "$.distributionDns.dnsName"
                                    },
                                    Iterator: {
                                        StartAt: "LinkAlias",
                                        States: {
                                            LinkAlias: {
                                                Type: "Task",
                                                Resource: "arn:aws:states:::lambda:invoke",
                                                Parameters: {
                                                    FunctionName: lambdaArn,
                                                    Payload: {
                                                        action: "link-route53-alias",
                                                        "hostedZoneId.$": "$.hostedZoneId",
                                                        "aliasName.$": "$.aliasName",
                                                        "distributionDnsName.$": "$.distributionDnsName"
                                                    }
                                                },
                                                ResultPath: "$.linkResult",
                                                ResultSelector: {
                                                    "aliasName.$": "$.Payload.aliasName",
                                                    "changeId.$": "$.Payload.changeId",
                                                    "status.$": "$.Payload.status"
                                                },
                                                Retry: [
                                                    {
                                                        ErrorEquals: ["States.ALL"],
                                                        IntervalSeconds: 10,
                                                        MaxAttempts: 3,
                                                        BackoffRate: 1.5
                                                    }
                                                ],
                                                Next: "WaitForLink"
                                            },
                                            WaitForLink: {
                                                Type: "Wait",
                                                Seconds: 15,
                                                Next: "CheckLinkStatus"
                                            },
                                            CheckLinkStatus: {
                                                Type: "Task",
                                                Resource: "arn:aws:states:::lambda:invoke",
                                                Parameters: {
                                                    FunctionName: lambdaArn,
                                                    Payload: {
                                                        action: "check-route53",
                                                        "changeId.$": "$.linkResult.changeId"
                                                    }
                                                },
                                                ResultPath: "$.checkResult",
                                                ResultSelector: {
                                                    "isComplete.$": "$.Payload.isComplete",
                                                    "status.$": "$.Payload.status"
                                                },
                                                Next: "IsLinkComplete"
                                            },
                                            IsLinkComplete: {
                                                Type: "Choice",
                                                Choices: [
                                                    {
                                                        Variable: "$.checkResult.isComplete",
                                                        BooleanEquals: true,
                                                        Next: "LinkDone"
                                                    }
                                                ],
                                                Default: "WaitForLink"
                                            },
                                            LinkDone: {
                                                Type: "Pass",
                                                End: true
                                            }
                                        }
                                    },
                                    ResultPath: "$.linkResults",
                                    Next: "EnableComplete"
                                },
                                SkipEnable: {
                                    Type: "Pass",
                                    Result: {
                                        skipped: true
                                    },
                                    End: true
                                },
                                EnableComplete: {
                                    Type: "Pass",
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.enableSecondaryResults",
                        Next: "NotifyTrafficRestored"
                    },
                    NotifyTrafficRestored: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "Secondary CloudFront Enabled",
                                message: "Secondary CloudFront distributions have been enabled. Traffic will be restored after DNS updates."
                            }
                        },
                        ResultPath: null,
                        Next: "TrackCloudFrontEnabled"
                    },
                    TrackCloudFrontEnabled: createStatusTrackingStep("CloudFrontEnabled", "DisablePrimaryFrontendCloudFront"),

                    // Step 8: Disable Primary Frontend CloudFront distributions
                    DisablePrimaryFrontendCloudFront: {
                        Type: "Map",
                        ItemsPath: "$.config.value.cloudFront",
                        MaxConcurrency: 3,
                        Iterator: {
                            StartAt: "CheckIfFrontendToDisable",
                            States: {
                                CheckIfFrontendToDisable: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            And: [
                                                {
                                                    Variable: "$.shouldDisable",
                                                    BooleanEquals: true
                                                },
                                                {
                                                    Variable: "$.type",
                                                    StringEquals: "frontend"
                                                }
                                            ],
                                            Next: "RemoveFrontendAliases"
                                        }
                                    ],
                                    Default: "SkipFrontendDisable"
                                },
                                RemoveFrontendAliases: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            And: [
                                                {
                                                    Variable: "$.aliasesToRemove",
                                                    IsPresent: true
                                                },
                                                {
                                                    Variable: "$.aliasesToRemove[0]",
                                                    IsPresent: true
                                                }
                                            ],
                                            Next: "RemoveAliasesFrontend"
                                        }
                                    ],
                                    Default: "DisableFrontendDistribution"
                                },
                                RemoveAliasesFrontend: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "remove-cloudfront-alias",
                                            "distributionId.$": "$.distributionId",
                                            "aliasesToRemove.$": "$.aliasesToRemove"
                                        }
                                    },
                                    ResultPath: "$.removeResult",
                                    ResultSelector: {
                                        "distributionId.$": "$.Payload.distributionId",
                                        "status.$": "$.Payload.status"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 20,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "WaitAfterRemoveFrontend"
                                },
                                WaitAfterRemoveFrontend: {
                                    Type: "Wait",
                                    Seconds: 60,
                                    Next: "CheckRemoveFrontendDeployment"
                                },
                                CheckRemoveFrontendDeployment: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check-cloudfront-deployment",
                                            "distributionId.$": "$.removeResult.distributionId"
                                        }
                                    },
                                    ResultPath: "$.deploymentCheck",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "status.$": "$.Payload.status"
                                    },
                                    Next: "IsRemoveFrontendDeploymentComplete"
                                },
                                IsRemoveFrontendDeploymentComplete: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.deploymentCheck.isComplete",
                                            BooleanEquals: true,
                                            Next: "DisableFrontendDistribution"
                                        }
                                    ],
                                    Default: "WaitAfterRemoveFrontend"
                                },
                                DisableFrontendDistribution: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "disable-cloudfront",
                                            "distributionId.$": "$.distributionId"
                                        }
                                    },
                                    ResultPath: "$.disableResult",
                                    ResultSelector: {
                                        "distributionId.$": "$.Payload.distributionId",
                                        "status.$": "$.Payload.status"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 20,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "WaitAfterDisableFrontend"
                                },
                                WaitAfterDisableFrontend: {
                                    Type: "Wait",
                                    Seconds: 60,
                                    Next: "CheckDisableFrontendDeployment"
                                },
                                CheckDisableFrontendDeployment: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check-cloudfront-deployment",
                                            "distributionId.$": "$.disableResult.distributionId"
                                        }
                                    },
                                    ResultPath: "$.deploymentCheck",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "status.$": "$.Payload.status"
                                    },
                                    Next: "IsDisableFrontendDeploymentComplete"
                                },
                                IsDisableFrontendDeploymentComplete: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.deploymentCheck.isComplete",
                                            BooleanEquals: true,
                                            Next: "FrontendDisableComplete"
                                        }
                                    ],
                                    Default: "WaitAfterDisableFrontend"
                                },
                                SkipFrontendDisable: {
                                    Type: "Pass",
                                    Result: {
                                        skipped: true
                                    },
                                    End: true
                                },
                                FrontendDisableComplete: {
                                    Type: "Pass",
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.disableFrontendResults",
                        Next: "NotifyFrontendDisabled"
                    },
                    NotifyFrontendDisabled: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "Primary Frontend CloudFront Disabled",
                                message: "Primary frontend CloudFront distributions have been disabled. Failover process is complete."
                            }
                        },
                        ResultPath: null,
                        Next: "TrackFailoverComplete"
                    },
                    TrackFailoverComplete: createStatusTrackingStep("FailoverComplete", "SendSuccessNotification"),

                    // Final Success Notification
                    SendSuccessNotification: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "Multi-Region Failover COMPLETED",
                                "message.$": "States.Format('Multi-region failover completed successfully! All services are now running in the secondary region: {}. The failover process has finished and all infrastructure has been migrated.', $.config.value.secondaryRegion)"
                            }
                        },
                        ResultPath: null,
                        End: true
                    },

                    // Failure Handler
                    FailoverFailed: {
                        Type: "Fail",
                        Error: "FailoverProcessFailed",
                        Cause: "The failover process encountered a critical error and could not complete"
                    }
                }
            });
        });

        /**
         * Step Functions State Machine
         */
        const stateMachine = new aws.sfn.StateMachine(`${this.config.project}-failover-sfn`, {
            name: `${this.config.generalPrefixShort}-failover`,
            roleArn: stateMachineRole.arn,
            definition: stateMachineDefinition,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-failover-sfn`,
            }
        }, {
            dependsOn: [
                lambdaFailover.lambdaFunction
            ]
        });

        return {
            stateMachine,
            stateMachineRole,
            lambdaFunction: lambdaFailover.lambdaFunction,
            lambdaRole: lambdaFailover.lambdaRole
        } as StepFunctionFailoverResult;
    }
}

export {StepFunctionFailover}
