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
            snsArn,
            cwLogsKmsKey,
            lambdaKmsKey,
            enableParamsSecure,
            ssmKmsKey
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

        // Attach policy to invoke lambda and read SSM parameters
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
                    }
                ]
            }))
        });

        /**
         * Step Functions State Machine Definition
         */
        const stateMachineDefinition = pulumi.all([
            lambdaFailover.lambdaFunction.arn,
            snsArn
        ]).apply(([lambdaArn, sns]) => {
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
                        Next: "SendStartNotification"
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
                                    Seconds: 30,
                                    Next: "DisableDistribution"
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
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 20,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "DisableComplete"
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
                        Next: "ValidateS3Replication"
                    },

                    // Step 2: Validate S3 Replication
                    ValidateS3Replication: {
                        Type: "Map",
                        ItemsPath: "$.config.value.s3Buckets",
                        MaxConcurrency: 3,
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
                                            "bucketName.$": "$.bucketName"
                                        }
                                    },
                                    ResultPath: "$.replicationCheck",
                                    ResultSelector: {
                                        "bucketName.$": "$.Payload.bucketName",
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
                                "secondaryClusterId.$": "$.config.value.rds.secondaryClusterId",
                                "secondaryRegion.$": "$.config.value.rds.secondaryClusterRegion"
                            }
                        },
                        ResultPath: "$.rdsPromotionResult",
                        ResultSelector: {
                            "statusCode.$": "$.Payload.statusCode",
                            "globalClusterId.$": "$.Payload.globalClusterId",
                            "secondaryClusterId.$": "$.Payload.secondaryClusterId",
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
                                "secondaryClusterId.$": "$.rdsPromotionResult.secondaryClusterId",
                                "secondaryRegion.$": "$.config.value.rds.secondaryClusterRegion"
                            }
                        },
                        ResultPath: "$.rdsCheckResult",
                        ResultSelector: {
                            "isComplete.$": "$.Payload.isComplete",
                            "isFailed.$": "$.Payload.isFailed",
                            "status.$": "$.Payload.status",
                            "clusterId.$": "$.Payload.clusterId"
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
                                "message.$": "States.Format('RDS Aurora cluster {} has been successfully promoted to primary in region {}', $.rdsCheckResult.clusterId, $.config.value.rds.secondaryClusterRegion)"
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
                                "message.$": "States.Format('CRITICAL: RDS cluster {} promotion failed with status: {}', $.rdsCheckResult.clusterId, $.rdsCheckResult.status)"
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
                                            "sourceFileSystemId.$": "$.sourceFileSystemId",
                                            "primaryRegion.$": "$$.Execution.Input.config.value.primaryRegion"
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
                                            "destinationFileSystemId.$": "$.disableResult.destinationFileSystemId",
                                            "destinationRegion.$": "$.disableResult.destinationRegion"
                                        }
                                    },
                                    ResultPath: "$.efsCheckResult",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "status.$": "$.Payload.status",
                                        "fileSystemId.$": "$.Payload.fileSystemId"
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
                        Next: "RestartEcsServices"
                    },

                    // Step 5: Restart ECS Services to ensure fresh connections
                    RestartEcsServices: {
                        Type: "Map",
                        ItemsPath: "$.config.value.ecsServices",
                        MaxConcurrency: 3,
                        Iterator: {
                            StartAt: "RestartService",
                            States: {
                                RestartService: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "restart-ecs-service",
                                            "clusterName.$": "$.clusterName",
                                            "serviceName.$": "$.serviceName"
                                        }
                                    },
                                    ResultPath: "$.restartResult",
                                    ResultSelector: {
                                        "clusterName.$": "$.Payload.clusterName",
                                        "serviceName.$": "$.Payload.serviceName",
                                        "taskDefinition.$": "$.Payload.taskDefinition",
                                        "desiredCount.$": "$.Payload.desiredCount",
                                        "deploymentId.$": "$.Payload.deploymentId",
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
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.ecsRestartResults",
                        Next: "NotifyEcsRestartComplete"
                    },
                    NotifyEcsRestartComplete: {
                        Type: "Task",
                        Resource: "arn:aws:states:::lambda:invoke",
                        Parameters: {
                            FunctionName: lambdaArn,
                            Payload: {
                                action: "notify",
                                snsArn: sns,
                                subject: "ECS Services Restarted",
                                "message.$": "States.Format('All ECS services have been restarted with fresh deployments. Total services: {}', States.ArrayLength($.ecsRestartResults))"
                            }
                        },
                        ResultPath: null,
                        Next: "CheckIfEventBridgeRulesExist"
                    },

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
                        Next: "EnableSecondaryCloudFront"
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
                                            "targetRegion.$": "$.targetRegion"
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
                                            "targetRegion.$": "$.targetRegion"
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
                                    Seconds: 30,
                                    Next: "AddAliasesPhase2"
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
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 20,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
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
                        Next: "UpdateRoute53Records"
                    },

                    // Step 8: Update Route53 DNS Records
                    UpdateRoute53Records: {
                        Type: "Map",
                        ItemsPath: "$.config.value.route53Records",
                        MaxConcurrency: 3,
                        Iterator: {
                            StartAt: "UpdateDNS",
                            States: {
                                UpdateDNS: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "update-route53",
                                            "hostedZoneId.$": "$.hostedZoneId",
                                            "recordName.$": "$.recordName",
                                            "newTargetDnsName.$": "$.newTargetDnsName"
                                        }
                                    },
                                    ResultPath: "$.updateResult",
                                    ResultSelector: {
                                        "changeId.$": "$.Payload.changeId",
                                        "status.$": "$.Payload.status",
                                        "recordName.$": "$.Payload.recordName",
                                        "detectedZoneId.$": "$.Payload.detectedZoneId"
                                    },
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 15,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "WaitForDNS"
                                },
                                WaitForDNS: {
                                    Type: "Wait",
                                    Seconds: 30,
                                    Next: "CheckDNS"
                                },
                                CheckDNS: {
                                    Type: "Task",
                                    Resource: "arn:aws:states:::lambda:invoke",
                                    Parameters: {
                                        FunctionName: lambdaArn,
                                        Payload: {
                                            action: "check-route53",
                                            "changeId.$": "$.updateResult.changeId"
                                        }
                                    },
                                    ResultPath: "$.dnsCheckResult",
                                    ResultSelector: {
                                        "isComplete.$": "$.Payload.isComplete",
                                        "status.$": "$.Payload.status",
                                        "changeId.$": "$.Payload.changeId"
                                    },
                                    Next: "IsDNSUpdated"
                                },
                                IsDNSUpdated: {
                                    Type: "Choice",
                                    Choices: [
                                        {
                                            Variable: "$.dnsCheckResult.isComplete",
                                            BooleanEquals: true,
                                            Next: "DNSComplete"
                                        }
                                    ],
                                    Default: "WaitForDNS"
                                },
                                DNSComplete: {
                                    Type: "Pass",
                                    End: true
                                }
                            }
                        },
                        ResultPath: "$.route53Results",
                        Next: "DisablePrimaryFrontendCloudFront"
                    },

                    // Step 9: Disable Primary Frontend CloudFront distributions
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
                                    Seconds: 30,
                                    Next: "DisableFrontendDistribution"
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
                                    Retry: [
                                        {
                                            ErrorEquals: ["States.ALL"],
                                            IntervalSeconds: 20,
                                            MaxAttempts: 3,
                                            BackoffRate: 1.5
                                        }
                                    ],
                                    Next: "FrontendDisableComplete"
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
                        Next: "SendSuccessNotification"
                    },

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
                                "message.$": "States.Format('Multi-region failover completed successfully! Secondary Region: {}. Backend CloudFront Disabled: {}. EventBridge Rules Disabled: {}. EventBridge Rules Enabled: {}. DNS Records Updated: {}. Frontend CloudFront Disabled: {}. All services are now running in the secondary region.', $.config.value.secondaryRegion, States.ArrayLength($.disablePrimaryResults), States.ArrayLength($.eventBridgeDisableResults), States.ArrayLength($.eventBridgeEnableResults), States.ArrayLength($.route53Results), States.ArrayLength($.disableFrontendResults))"
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
            lambdaFunction: lambdaFailover.lambdaFunction
        } as StepFunctionFailoverResult;
    }
}

export {StepFunctionFailover}
