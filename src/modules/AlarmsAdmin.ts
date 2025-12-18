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

        const snsArn = alarmsAdminConfig.snsArn;

        // Create EventBridge rules for VPC changes
        if (alarmsAdminConfig.monitorVpcChanges !== false) {
            const vpcRule = this.createVpcChangeRule(snsArn, logGroup);
            result.eventRules.push(vpcRule.rule);
            result.eventTargets.push(...vpcRule.targets);
        }

        // Create EventBridge rules for Route Table changes
        if (alarmsAdminConfig.monitorRouteTableChanges !== false) {
            const routeTableRule = this.createRouteTableChangeRule(snsArn, logGroup);
            result.eventRules.push(routeTableRule.rule);
            result.eventTargets.push(...routeTableRule.targets);
        }

        // Create EventBridge rules for Security Group changes
        if (alarmsAdminConfig.monitorSecurityGroupChanges !== false) {
            const sgRule = this.createSecurityGroupChangeRule(snsArn, logGroup);
            result.eventRules.push(sgRule.rule);
            result.eventTargets.push(...sgRule.targets);
        }

        // Create EventBridge rules for Network ACL changes
        if (alarmsAdminConfig.monitorNetworkAclChanges !== false) {
            const naclRule = this.createNetworkAclChangeRule(snsArn, logGroup);
            result.eventRules.push(naclRule.rule);
            result.eventTargets.push(...naclRule.targets);
        }

        // Create EventBridge rules for Internet Gateway changes
        if (alarmsAdminConfig.monitorInternetGatewayChanges !== false) {
            const igwRule = this.createInternetGatewayChangeRule(snsArn, logGroup);
            result.eventRules.push(igwRule.rule);
            result.eventTargets.push(...igwRule.targets);
        }

        // Create EventBridge rules for Network Gateway changes (NAT, VPN, etc)
        if (alarmsAdminConfig.monitorNetworkGatewayChanges !== false) {
            const ngwRule = this.createNetworkGatewayChangeRule(snsArn, logGroup);
            result.eventRules.push(ngwRule.rule);
            result.eventTargets.push(...ngwRule.targets);
        }

        // Create EventBridge rules for AWS Config changes
        if (alarmsAdminConfig.monitorAwsConfigChanges !== false) {
            const configRule = this.createAwsConfigChangeRule(snsArn, logGroup);
            result.eventRules.push(configRule.rule);
            result.eventTargets.push(...configRule.targets);
        }

        // Create EventBridge rules for CloudTrail changes
        if (alarmsAdminConfig.monitorCloudTrailChanges !== false) {
            const cloudTrailRule = this.createCloudTrailChangeRule(snsArn, logGroup);
            result.eventRules.push(cloudTrailRule.rule);
            result.eventTargets.push(...cloudTrailRule.targets);
        }

        // Create EventBridge rules for KMS changes
        if (alarmsAdminConfig.monitorKmsChanges !== false) {
            const kmsRule = this.createKmsChangeRule(snsArn, logGroup);
            result.eventRules.push(kmsRule.rule);
            result.eventTargets.push(...kmsRule.targets);
        }

        // Create EventBridge rules for S3 changes
        if (alarmsAdminConfig.monitorS3Changes !== false) {
            const s3Rule = this.createS3ChangeRule(snsArn, logGroup);
            result.eventRules.push(s3Rule.rule);
            result.eventTargets.push(...s3Rule.targets);
        }

        // Create EventBridge rules for IAM changes
        if (alarmsAdminConfig.monitorIamChanges !== false) {
            const iamRule = this.createIamChangeRule(snsArn, logGroup);
            result.eventRules.push(iamRule.rule);
            result.eventTargets.push(...iamRule.targets);
        }

        return result;
    }

    /**
     * Create EventBridge rule for VPC changes
     */
    private createVpcChangeRule(snsArn: pulumi.Input<string>, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-vpc-changes`, {
            name: `${this.config.generalPrefix}-vpc-changes`,
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

        const snsTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-vpc-sns-target`, {
            rule: rule.name,
            arn: snsArn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time"
                },
                inputTemplate: `"VPC Change Detected! Event: <eventName> | User: <userName> | Region: <region> | Time: <time>"`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-vpc-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [snsTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Route Table changes
     */
    private createRouteTableChangeRule(snsArn: pulumi.Input<string>, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-rt-changes`, {
            name: `${this.config.generalPrefix}-route-table-changes`,
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

        const snsTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-rt-sns-target`, {
            rule: rule.name,
            arn: snsArn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time"
                },
                inputTemplate: `"Route Table Change Detected! Event: <eventName> | User: <userName> | Region: <region> | Time: <time>"`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-rt-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [snsTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Security Group changes
     */
    private createSecurityGroupChangeRule(snsArn: pulumi.Input<string>, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-sg-changes`, {
            name: `${this.config.generalPrefix}-security-group-changes`,
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

        const snsTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-sg-sns-target`, {
            rule: rule.name,
            arn: snsArn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time"
                },
                inputTemplate: `"Security Group Change Detected! Event: <eventName> | User: <userName> | Region: <region> | Time: <time>"`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-sg-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [snsTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Network ACL changes
     */
    private createNetworkAclChangeRule(snsArn: pulumi.Input<string>, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-nacl-changes`, {
            name: `${this.config.generalPrefix}-network-acl-changes`,
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

        const snsTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-nacl-sns-target`, {
            rule: rule.name,
            arn: snsArn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time"
                },
                inputTemplate: `"Network ACL Change Detected! Event: <eventName> | User: <userName> | Region: <region> | Time: <time>"`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-nacl-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [snsTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Internet Gateway changes
     */
    private createInternetGatewayChangeRule(snsArn: pulumi.Input<string>, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-igw-changes`, {
            name: `${this.config.generalPrefix}-internet-gateway-changes`,
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

        const snsTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-igw-sns-target`, {
            rule: rule.name,
            arn: snsArn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time"
                },
                inputTemplate: `"Internet Gateway Change Detected! Event: <eventName> | User: <userName> | Region: <region> | Time: <time>"`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-igw-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [snsTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for Network Gateway changes (NAT, VPN, Customer Gateway, etc)
     */
    private createNetworkGatewayChangeRule(snsArn: pulumi.Input<string>, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-ngw-changes`, {
            name: `${this.config.generalPrefix}-network-gateway-changes`,
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

        const snsTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-ngw-sns-target`, {
            rule: rule.name,
            arn: snsArn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time"
                },
                inputTemplate: `"Network Gateway Change Detected! Event: <eventName> | User: <userName> | Region: <region> | Time: <time>"`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-ngw-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [snsTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for AWS Config changes
     */
    private createAwsConfigChangeRule(snsArn: pulumi.Input<string>, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-config-changes`, {
            name: `${this.config.generalPrefix}-aws-config-changes`,
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

        const snsTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-config-sns-target`, {
            rule: rule.name,
            arn: snsArn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time"
                },
                inputTemplate: `"AWS Config Change Detected! Event: <eventName> | User: <userName> | Region: <region> | Time: <time>"`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-config-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [snsTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for CloudTrail changes
     */
    private createCloudTrailChangeRule(snsArn: pulumi.Input<string>, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-cloudtrail-changes`, {
            name: `${this.config.generalPrefix}-cloudtrail-changes`,
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

        const snsTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-cloudtrail-sns-target`, {
            rule: rule.name,
            arn: snsArn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time"
                },
                inputTemplate: `"CloudTrail Change Detected! Event: <eventName> | User: <userName> | Region: <region> | Time: <time>"`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-cloudtrail-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [snsTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for KMS changes
     */
    private createKmsChangeRule(snsArn: pulumi.Input<string>, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-kms-changes`, {
            name: `${this.config.generalPrefix}-kms-changes`,
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

        const snsTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-kms-sns-target`, {
            rule: rule.name,
            arn: snsArn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time"
                },
                inputTemplate: `"KMS Change Detected! Event: <eventName> | User: <userName> | Region: <region> | Time: <time>"`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-kms-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [snsTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for S3 changes
     */
    private createS3ChangeRule(snsArn: pulumi.Input<string>, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-s3-changes`, {
            name: `${this.config.generalPrefix}-s3-changes`,
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

        const snsTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-s3-sns-target`, {
            rule: rule.name,
            arn: snsArn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    bucketName: "$.detail.requestParameters.bucketName",
                    region: "$.region",
                    time: "$.time"
                },
                inputTemplate: `"S3 Change Detected! Event: <eventName> | Bucket: <bucketName> | User: <userName> | Region: <region> | Time: <time>"`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-s3-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [snsTarget, logTarget] };
    }

    /**
     * Create EventBridge rule for IAM changes
     */
    private createIamChangeRule(snsArn: pulumi.Input<string>, logGroup: aws.cloudwatch.LogGroup): { rule: aws.cloudwatch.EventRule; targets: aws.cloudwatch.EventTarget[] } {
        const rule = new aws.cloudwatch.EventRule(`${this.config.project}-alarms-admin-iam-changes`, {
            name: `${this.config.generalPrefix}-iam-changes`,
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

        const snsTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-iam-sns-target`, {
            rule: rule.name,
            arn: snsArn,
            inputTransformer: {
                inputPaths: {
                    eventName: "$.detail.eventName",
                    userName: "$.detail.userIdentity.principalId",
                    region: "$.region",
                    time: "$.time"
                },
                inputTemplate: `"IAM Change Detected! Event: <eventName> | User: <userName> | Region: <region> | Time: <time>"`
            }
        });

        const logTarget = new aws.cloudwatch.EventTarget(`${this.config.project}-alarms-admin-iam-log-target`, {
            rule: rule.name,
            arn: logGroup.arn
        });

        return { rule, targets: [snsTarget, logTarget] };
    }
}

export {AlarmsAdmin}
