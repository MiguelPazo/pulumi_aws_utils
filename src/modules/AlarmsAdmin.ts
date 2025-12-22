/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {AlarmsAdminConfig, AlarmsAdminResult} from "../types";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class AlarmsAdmin {
    private static __instance: AlarmsAdmin;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): AlarmsAdmin {
        if (this.__instance == null) {
            this.__instance = new AlarmsAdmin();
        }

        return this.__instance;
    }

    async main(alarmsAdminConfig: AlarmsAdminConfig): Promise<AlarmsAdminResult> {
        // Create CloudWatch Log Group for debugging events
        const logGroup = new aws.cloudwatch.LogGroup(`${this.config.project}-alarms-admin-events-log`, {
            name: `/aws/alarms/admin-events/`,
            retentionInDays: this.config.cloudwatchRetentionLogs,
            kmsKeyId: alarmsAdminConfig.kmsKey.arn,
            tags: {
                ...this.config.generalTags,
                Name: `/aws/alarms/admin-events/`
            }
        });

        // Create resource policy to allow EventBridge to write to CloudWatch Logs
        const logGroupPolicy = new aws.cloudwatch.LogResourcePolicy(`${this.config.project}-alarms-admin-events-log-policy`, {
            policyName: `${this.config.generalPrefix}-alarms-admin-events-log-policy`,
            policyDocument: pulumi.all([logGroup.arn]).apply(([logGroupArn]) => JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Principal: {
                            Service: [
                                "events.amazonaws.com",
                                "delivery.logs.amazonaws.com"
                            ]
                        },
                        Action: [
                            "logs:CreateLogStream",
                            "logs:PutLogEvents"
                        ],
                        Resource: `${logGroupArn}:*`
                    }
                ]
            }))
        });

        const result: AlarmsAdminResult = {
            logGroup,
            logGroupPolicy,
            eventRules: [],
            eventTargets: []
        };

        const lambdaFunction = alarmsAdminConfig.lambdaFunction;

        // Create a single Lambda permission for all EventBridge rules using wildcard
        new aws.lambda.Permission(`${this.config.project}-alarms-admin-lambda-permission`, {
            action: "lambda:InvokeFunction",
            function: lambdaFunction.name,
            principal: "events.amazonaws.com",
            sourceArn: pulumi.interpolate`arn:aws:events:${this.config.region}:${this.config.accountId}:rule/${this.config.generalPrefix}-alarm-*`
        });

        // Create EventBridge rules for VPC changes
        if (alarmsAdminConfig.monitorVpcChanges !== false) {
            const vpcRule = this.createVpcChangeRule(lambdaFunction, logGroup);
            result.eventRules.push(vpcRule.rule);
            result.eventTargets.push(...vpcRule.targets);
        }

        // Create EventBridge rules for Route Table changes
        if (alarmsAdminConfig.monitorRouteTableChanges !== false) {
            const routeTableRule = this.createRouteTableChangeRule(lambdaFunction, logGroup);
            result.eventRules.push(routeTableRule.rule);
            result.eventTargets.push(...routeTableRule.targets);
        }

        // Create EventBridge rules for Security Group changes
        if (alarmsAdminConfig.monitorSecurityGroupChanges !== false) {
            const sgRule = this.createSecurityGroupChangeRule(lambdaFunction, logGroup);
            result.eventRules.push(sgRule.rule);
            result.eventTargets.push(...sgRule.targets);
        }

        // Create EventBridge rules for Network ACL changes
        if (alarmsAdminConfig.monitorNetworkAclChanges !== false) {
            const naclRule = this.createNetworkAclChangeRule(lambdaFunction, logGroup);
            result.eventRules.push(naclRule.rule);
            result.eventTargets.push(...naclRule.targets);
        }

        // Create EventBridge rules for Internet Gateway changes
        if (alarmsAdminConfig.monitorInternetGatewayChanges !== false) {
            const igwRule = this.createInternetGatewayChangeRule(lambdaFunction, logGroup);
            result.eventRules.push(igwRule.rule);
            result.eventTargets.push(...igwRule.targets);
        }

        // Create EventBridge rules for Network Gateway changes (NAT, VPN, etc)
        if (alarmsAdminConfig.monitorNetworkGatewayChanges !== false) {
            const ngwRule = this.createNetworkGatewayChangeRule(lambdaFunction, logGroup);
            result.eventRules.push(ngwRule.rule);
            result.eventTargets.push(...ngwRule.targets);
        }

        // Create EventBridge rules for AWS Config changes
        if (alarmsAdminConfig.monitorAwsConfigChanges !== false) {
            const configRule = this.createAwsConfigChangeRule(lambdaFunction, logGroup);
            result.eventRules.push(configRule.rule);
            result.eventTargets.push(...configRule.targets);
        }

        // Create EventBridge rules for CloudTrail changes
        if (alarmsAdminConfig.monitorCloudTrailChanges !== false) {
            const cloudTrailRule = this.createCloudTrailChangeRule(lambdaFunction, logGroup);
            result.eventRules.push(cloudTrailRule.rule);
            result.eventTargets.push(...cloudTrailRule.targets);
        }

        // Create EventBridge rules for KMS changes
        if (alarmsAdminConfig.monitorKmsChanges !== false) {
            const kmsRule = this.createKmsChangeRule(lambdaFunction, logGroup);
            result.eventRules.push(kmsRule.rule);
            result.eventTargets.push(...kmsRule.targets);
        }

        // Create EventBridge rules for S3 changes
        if (alarmsAdminConfig.monitorS3Changes !== false) {
            const s3Rule = this.createS3ChangeRule(lambdaFunction, logGroup);
            result.eventRules.push(s3Rule.rule);
            result.eventTargets.push(...s3Rule.targets);
        }

        // Create EventBridge rules for IAM changes
        if (alarmsAdminConfig.monitorIamChanges !== false) {
            const iamRule = this.createIamChangeRule(lambdaFunction, logGroup);
            result.eventRules.push(iamRule.rule);
            result.eventTargets.push(...iamRule.targets);
        }

        // Create EventBridge rules for Console Login Failures
        if (alarmsAdminConfig.monitorConsoleLoginFailures !== false) {
            const consoleLoginRule = this.createConsoleLoginFailureRule(lambdaFunction, logGroup);
            result.eventRules.push(consoleLoginRule.rule);
            result.eventTargets.push(...consoleLoginRule.targets);
        }

        // Create EventBridge rules for Root Account Access
        if (alarmsAdminConfig.monitorRootAccountAccess !== false) {
            const rootAccessRule = this.createRootAccountAccessRule(lambdaFunction, logGroup);
            result.eventRules.push(rootAccessRule.rule);
            result.eventTargets.push(...rootAccessRule.targets);
        }

        // Create EventBridge rules for Access Without MFA
        if (alarmsAdminConfig.monitorAccessWithoutMfa !== false) {
            const noMfaRule = this.createAccessWithoutMfaRule(lambdaFunction, logGroup);
            result.eventRules.push(noMfaRule.rule);
            result.eventTargets.push(...noMfaRule.targets);
        }

        return result;
    }

    /**
     * Create EventBridge rule for VPC changes
     */
    private createVpcChangeRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-vpc-changes`, {
            name: `${this.config.generalPrefix}-alarm-vpc-changes`,
            description: "Capture all VPC related changes",
            eventPattern: JSON.stringify({
                source: ["aws.ec2"],
                "detail-type": ["AWS API Call via CloudTrail"],
                detail: {
                    eventSource: ["ec2.amazonaws.com"],
                    eventName: [
                        // VPC operations
                        "CreateVpc",
                        "DeleteVpc",
                        "ModifyVpcAttribute",
                        "AssociateVpcCidrBlock",
                        "DisassociateVpcCidrBlock",
                        "EnableVpcClassicLink",
                        "DisableVpcClassicLink",
                        "EnableVpcClassicLinkDnsSupport",
                        "DisableVpcClassicLinkDnsSupport",
                        // VPC Peering
                        "CreateVpcPeeringConnection",
                        "DeleteVpcPeeringConnection",
                        "AcceptVpcPeeringConnection",
                        "RejectVpcPeeringConnection",
                        "ModifyVpcPeeringConnectionOptions",
                        // VPC Endpoints
                        "CreateVpcEndpoint",
                        "DeleteVpcEndpoints",
                        "ModifyVpcEndpoint",
                        "CreateVpcEndpointServiceConfiguration",
                        "DeleteVpcEndpointServiceConfigurations",
                        "ModifyVpcEndpointServiceConfiguration",
                        // DHCP Options
                        "CreateDhcpOptions",
                        "DeleteDhcpOptions",
                        "AssociateDhcpOptions"
                    ]
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-vpc-changes`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-vpc-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"VPC Change","event":"<eventName>","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-vpc-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Route Table changes
     */
    private createRouteTableChangeRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-rt-changes`, {
            name: `${this.config.generalPrefix}-alarm-route-table-changes`,
            description: "Capture Route Table configuration changes",
            eventPattern: JSON.stringify({
                source: ["aws.ec2"],
                "detail-type": ["AWS API Call via CloudTrail"],
                detail: {
                    eventSource: ["ec2.amazonaws.com"],
                    eventName: [
                        "CreateRoute",
                        "CreateRouteTable",
                        "ReplaceRoute",
                        "ReplaceRouteTableAssociation",
                        "DeleteRoute",
                        "DeleteRouteTable",
                        "DisassociateRouteTable",
                        "AssociateRouteTable"
                    ]
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-route-table-changes`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-rt-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"Route Table Change","event":"<eventName>","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-rt-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Security Group changes
     */
    private createSecurityGroupChangeRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-sg-changes`, {
            name: `${this.config.generalPrefix}-alarm-security-group-changes`,
            description: "Capture Security Group configuration changes",
            eventPattern: JSON.stringify({
                source: ["aws.ec2"],
                "detail-type": ["AWS API Call via CloudTrail"],
                detail: {
                    eventSource: ["ec2.amazonaws.com"],
                    eventName: [
                        "AuthorizeSecurityGroupIngress",
                        "AuthorizeSecurityGroupEgress",
                        "RevokeSecurityGroupIngress",
                        "RevokeSecurityGroupEgress",
                        "CreateSecurityGroup",
                        "DeleteSecurityGroup"
                    ]
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-security-group-changes`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-sg-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"Security Group Change","event":"<eventName>","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-sg-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Network ACL changes
     */
    private createNetworkAclChangeRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-nacl-changes`, {
            name: `${this.config.generalPrefix}-alarm-network-acl-changes`,
            description: "Capture Network ACL creation, modification and deletion",
            eventPattern: JSON.stringify({
                source: ["aws.ec2"],
                "detail-type": ["AWS API Call via CloudTrail"],
                detail: {
                    eventSource: ["ec2.amazonaws.com"],
                    eventName: [
                        "CreateNetworkAcl",
                        "CreateNetworkAclEntry",
                        "DeleteNetworkAcl",
                        "DeleteNetworkAclEntry",
                        "ReplaceNetworkAclEntry",
                        "ReplaceNetworkAclAssociation",
                        "ModifyNetworkAclAttribute"
                    ]
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-network-acl-changes`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-nacl-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"Network ACL Change","event":"<eventName>","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-nacl-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Internet Gateway changes
     */
    private createInternetGatewayChangeRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-igw-changes`, {
            name: `${this.config.generalPrefix}-alarm-internet-gateway-changes`,
            description: "Capture Internet Gateway configuration changes",
            eventPattern: JSON.stringify({
                source: ["aws.ec2"],
                "detail-type": ["AWS API Call via CloudTrail"],
                detail: {
                    eventSource: ["ec2.amazonaws.com"],
                    eventName: [
                        "CreateInternetGateway",
                        "DeleteInternetGateway",
                        "AttachInternetGateway",
                        "DetachInternetGateway"
                    ]
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-internet-gateway-changes`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-igw-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"Internet Gateway Change","event":"<eventName>","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-igw-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Network Gateway changes (NAT, VPN, Customer Gateway, etc)
     */
    private createNetworkGatewayChangeRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-ngw-changes`, {
            name: `${this.config.generalPrefix}-alarm-network-gateway-changes`,
            description: "Capture Network Gateway (NAT, VPN, CGW) creation, modification and deletion",
            eventPattern: JSON.stringify({
                source: ["aws.ec2"],
                "detail-type": ["AWS API Call via CloudTrail"],
                detail: {
                    eventSource: ["ec2.amazonaws.com"],
                    eventName: [
                        // NAT Gateway
                        "CreateNatGateway",
                        "DeleteNatGateway",
                        // VPN Gateway
                        "CreateVpnGateway",
                        "DeleteVpnGateway",
                        "AttachVpnGateway",
                        "DetachVpnGateway",
                        // Customer Gateway
                        "CreateCustomerGateway",
                        "DeleteCustomerGateway",
                        // VPN Connection
                        "CreateVpnConnection",
                        "DeleteVpnConnection",
                        "ModifyVpnConnection",
                        "ModifyVpnConnectionOptions",
                        "ModifyVpnTunnelOptions",
                        // Transit Gateway
                        "CreateTransitGateway",
                        "DeleteTransitGateway",
                        "ModifyTransitGateway",
                        "CreateTransitGatewayVpcAttachment",
                        "DeleteTransitGatewayVpcAttachment",
                        "ModifyTransitGatewayVpcAttachment"
                    ]
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-network-gateway-changes`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-ngw-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"Network Gateway Change","event":"<eventName>","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-ngw-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for AWS Config changes
     */
    private createAwsConfigChangeRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-config-changes`, {
            name: `${this.config.generalPrefix}-alarm-aws-config-changes`,
            description: "Capture critical AWS Config changes",
            eventPattern: JSON.stringify({
                source: ["aws.config"],
                "detail-type": ["AWS API Call via CloudTrail"],
                detail: {
                    eventSource: ["config.amazonaws.com"],
                    eventName: [
                        "StopConfigurationRecorder",
                        "DeleteDeliveryChannel",
                        "PutConfigurationRecorder",
                        "PutDeliveryChannel",
                        "DeleteConfigurationRecorder"
                    ]
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-aws-config-changes`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-config-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"AWS Config Change","event":"<eventName>","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-config-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for CloudTrail changes
     */
    private createCloudTrailChangeRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-cloudtrail-changes`, {
            name: `${this.config.generalPrefix}-alarm-cloudtrail-changes`,
            description: "Capture critical CloudTrail changes",
            eventPattern: JSON.stringify({
                source: ["aws.cloudtrail"],
                "detail-type": ["AWS API Call via CloudTrail"],
                detail: {
                    eventSource: ["cloudtrail.amazonaws.com"],
                    eventName: [
                        "StopLogging",
                        "DeleteTrail",
                        "UpdateTrail",
                        "PutEventSelectors",
                        "RemoveTags",
                        "AddTags"
                    ]
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-cloudtrail-changes`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-cloudtrail-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"CloudTrail Change","event":"<eventName>","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-cloudtrail-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for KMS changes
     */
    private createKmsChangeRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-kms-changes`, {
            name: `${this.config.generalPrefix}-alarm-kms-changes`,
            description: "Capture critical KMS key changes",
            eventPattern: JSON.stringify({
                source: ["aws.kms"],
                "detail-type": ["AWS API Call via CloudTrail"],
                detail: {
                    eventSource: ["kms.amazonaws.com"],
                    eventName: [
                        "DisableKey",
                        "ScheduleKeyDeletion",
                        "CancelKeyDeletion",
                        "DeleteAlias",
                        "DeleteImportedKeyMaterial",
                        "PutKeyPolicy"
                    ]
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-kms-changes`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-kms-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"KMS Change","event":"<eventName>","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-kms-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for S3 changes
     */
    private createS3ChangeRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-s3-changes`, {
            name: `${this.config.generalPrefix}-alarm-s3-changes`,
            description: "Capture critical S3 bucket policy changes",
            eventPattern: JSON.stringify({
                source: ["aws.s3"],
                "detail-type": ["AWS API Call via CloudTrail"],
                detail: {
                    eventSource: ["s3.amazonaws.com"],
                    eventName: [
                        "PutBucketPolicy",
                        "DeleteBucketPolicy",
                        "PutBucketAcl",
                        "PutBucketPublicAccessBlock",
                        "DeleteBucketPublicAccessBlock"
                    ]
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-s3-changes`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-s3-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    bucketName: "$.detail.requestParameters.bucketName",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"S3 Change","event":"<eventName>","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>","bucket":"<bucketName>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-s3-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for IAM changes
     */
    private createIamChangeRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-iam-changes`, {
            name: `${this.config.generalPrefix}-alarm-iam-changes`,
            description: "Capture critical IAM policy and permission changes",
            eventPattern: JSON.stringify({
                source: ["aws.iam"],
                "detail-type": ["AWS API Call via CloudTrail"],
                detail: {
                    eventSource: ["iam.amazonaws.com"],
                    eventName: [
                        "CreatePolicy",
                        "DeletePolicy",
                        "CreatePolicyVersion",
                        "DeletePolicyVersion",
                        "SetDefaultPolicyVersion",
                        "AttachRolePolicy",
                        "DetachRolePolicy",
                        "AttachUserPolicy",
                        "DetachUserPolicy",
                        "AttachGroupPolicy",
                        "DetachGroupPolicy",
                        "PutRolePolicy",
                        "PutUserPolicy",
                        "PutGroupPolicy"
                    ]
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-iam-changes`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-iam-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"IAM Change","event":"<eventName>","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-iam-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Console Login Failures
     */
    private createConsoleLoginFailureRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-console-login-failures`, {
            name: `${this.config.generalPrefix}-alarm-console-login-failures`,
            description: "Capture failed AWS Console login attempts",
            eventPattern: JSON.stringify({
                source: ["aws.signin"],
                "detail-type": ["AWS Console Sign In via CloudTrail"],
                detail: {
                    eventName: ["ConsoleLogin"],
                    responseElements: {
                        ConsoleLogin: ["Failure"]
                    }
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-console-login-failures`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-login-fail-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    userName: "$.detail.userIdentity.principalId",
                    sourceIp: "$.detail.sourceIPAddress",
                    userAgent: "$.detail.userAgent",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"Console Login Failure","event":"ConsoleLogin","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>","sourceIp":"<sourceIp>","userAgent":"<userAgent>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-login-fail-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Root Account Access
     */
    private createRootAccountAccessRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-root-account-access`, {
            name: `${this.config.generalPrefix}-alarm-root-account-access`,
            description: "Capture any activity with AWS root account",
            eventPattern: JSON.stringify({
                source: ["aws.signin"],
                "detail-type": ["AWS Console Sign In via CloudTrail"],
                detail: {
                    userIdentity: {
                        type: ["Root"]
                    }
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-root-account-access`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-root-access-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    sourceIp: "$.detail.sourceIPAddress",
                    userAgent: "$.detail.userAgent",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"Root Account Access","event":"<eventName>","user":"ROOT","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>","sourceIp":"<sourceIp>","userAgent":"<userAgent>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-root-access-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Access Without MFA
     */
    private createAccessWithoutMfaRule(lambdaFunction: aws.lambda.Function, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-access-without-mfa`, {
            name: `${this.config.generalPrefix}-alarm-access-without-mfa`,
            description: "Capture console login attempts without MFA",
            eventPattern: JSON.stringify({
                source: ["aws.signin"],
                "detail-type": ["AWS Console Sign In via CloudTrail"],
                detail: {
                    eventName: ["ConsoleLogin"],
                    additionalEventData: {
                        MFAUsed: ["No"]
                    }
                }
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-access-without-mfa`
            }
        });

        const lambdaTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-no-mfa-lambda-target`, {
            rule: rule.name,
            arn: lambdaFunction.arn,
            inputTransformer: {
                inputPaths: {
                    userName: "$.detail.userIdentity.principalId",
                    sourceIp: "$.detail.sourceIPAddress",
                    userAgent: "$.detail.userAgent",
                    region: "$.region",
                    time: "$.time",
                    accountId: "$.account"
                },
                inputTemplate: `{"type":"alarm-admin","title":"Login Without MFA","event":"ConsoleLogin","user":"<userName>","account":"<accountId>","stack":"${this.config.stack}","region":"<region>","time":"<time>","sourceIp":"<sourceIp>","userAgent":"<userAgent>"}`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-no-mfa-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [lambdaTarget, logTarget] };
    }
}

export {AlarmsAdmin}
