/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {AlarmsCISConfig, AlarmsCISResult} from "../types";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class AlarmsCIS {
    private static __instance: AlarmsCIS;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): AlarmsCIS {
        if (this.__instance == null) {
            this.__instance = new AlarmsCIS();
        }

        return this.__instance;
    }

    async main(cisConfig: AlarmsCISConfig): Promise<AlarmsCISResult> {
        const metricFilters: aws.cloudwatch.LogMetricFilter[] = [];
        const alarms: aws.cloudwatch.MetricAlarm[] = [];
        const namespace = `${this.config.generalPrefix}/CISBenchmark`;

        // Prioritize lambdaAlarmsArn over snsTopicArn
        const actionArn = cisConfig.lambdaAlarmsArn || cisConfig.snsTopicArn;

        if (!actionArn) {
            throw new Error("Either lambdaAlarmsArn or snsTopicArn must be provided");
        }

        // Build CIS 3.1 pattern with optional exclusions
        let unauthorizedApiCallsPattern = '{ ($.errorCode = "*UnauthorizedOperation") || ($.errorCode = "AccessDenied*") }';
        if (cisConfig.excludeUnauthorizedApiCallsEventSources && cisConfig.excludeUnauthorizedApiCallsEventSources.length > 0) {
            const exclusions = cisConfig.excludeUnauthorizedApiCallsEventSources.map(source => `($.eventSource != "${source}")`).join(" && ");
            unauthorizedApiCallsPattern = `{ (($.errorCode = "*UnauthorizedOperation") || ($.errorCode = "AccessDenied*")) && ${exclusions} }`;
        }

        const metrics: { enabled: boolean; shortName: string; metricName: string; pattern: string; description: string; cisTag: string; threshold?: number }[] = [
            {
                enabled: cisConfig.enableUnauthorizedApiCalls !== false,
                shortName: "cis-unauthorized-api-calls",
                metricName: "UnauthorizedAPICalls",
                pattern: unauthorizedApiCallsPattern,
                description: "CIS 3.1 - Monitors unauthorized API calls",
                cisTag: "3.1"
            },
            {
                enabled: cisConfig.enableConsoleSignInWithoutMfa !== false,
                shortName: "cis-console-signin-without-mfa",
                metricName: "ConsoleSignInWithoutMFA",
                pattern: '{ ($.eventName = "ConsoleLogin") && ($.additionalEventData.MFAUsed != "Yes") && ($.userIdentity.type = "IAMUser") && ($.responseElements.ConsoleLogin = "Success") }',
                description: "CIS 3.2 - Monitors console sign-in without MFA",
                cisTag: "3.2"
            },
            {
                enabled: cisConfig.enableRootAccountUsage !== false,
                shortName: "cis-root-account-usage",
                metricName: "RootAccountUsage",
                pattern: '{ $.userIdentity.type = "Root" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != "AwsServiceEvent" }',
                description: "CIS 3.3 - Monitors root account usage",
                cisTag: "3.3"
            },
            {
                enabled: cisConfig.enableIamPolicyChanges !== false,
                shortName: "cis-iam-policy-changes",
                metricName: "IAMPolicyChanges",
                pattern: '{($.eventName=DeleteGroupPolicy)||($.eventName=DeleteRolePolicy)||($.eventName=DeleteUserPolicy)||($.eventName=PutGroupPolicy)||($.eventName=PutRolePolicy)||($.eventName=PutUserPolicy)||($.eventName=CreatePolicy)||($.eventName=DeletePolicy)||($.eventName=CreatePolicyVersion)||($.eventName=DeletePolicyVersion)||($.eventName=AttachRolePolicy)||($.eventName=DetachRolePolicy)||($.eventName=AttachUserPolicy)||($.eventName=DetachUserPolicy)||($.eventName=AttachGroupPolicy)||($.eventName=DetachGroupPolicy)}',
                description: "CIS 3.4 - Monitors IAM policy changes",
                cisTag: "3.4"
            },
            {
                enabled: cisConfig.enableCloudTrailChanges !== false,
                shortName: "cis-cloudtrail-changes",
                metricName: "CloudTrailConfigChanges",
                pattern: '{ ($.eventName = CreateTrail) || ($.eventName = UpdateTrail) || ($.eventName = DeleteTrail) || ($.eventName = StartLogging) || ($.eventName = StopLogging) }',
                description: "CIS 3.5 - Monitors CloudTrail configuration changes",
                cisTag: "3.5"
            },
            {
                enabled: cisConfig.enableConsoleAuthenticationFailures !== false,
                shortName: "cis-console-auth-failures",
                metricName: "ConsoleAuthenticationFailures",
                pattern: '{ ($.eventName = ConsoleLogin) && ($.errorMessage = "Failed authentication") }',
                description: "CIS 3.6 - Monitors console authentication failures",
                cisTag: "3.6",
                threshold: 3
            },
            {
                enabled: cisConfig.enableDisableOrDeleteKms !== false,
                shortName: "cis-disable-delete-kms",
                metricName: "DisableOrDeleteKMSKeys",
                pattern: '{ ($.eventSource = kms.amazonaws.com) && (($.eventName = DisableKey) || ($.eventName = ScheduleKeyDeletion)) }',
                description: "CIS 3.7 - Monitors disabling or deletion of KMS keys",
                cisTag: "3.7"
            },
            {
                enabled: cisConfig.enableS3BucketPolicyChanges !== false,
                shortName: "cis-s3-bucket-policy-changes",
                metricName: "S3BucketPolicyChanges",
                pattern: '{ ($.eventSource = s3.amazonaws.com) && (($.eventName = PutBucketAcl) || ($.eventName = PutBucketPolicy) || ($.eventName = PutBucketCors) || ($.eventName = PutBucketLifecycle) || ($.eventName = PutBucketReplication) || ($.eventName = DeleteBucketPolicy) || ($.eventName = DeleteBucketCors) || ($.eventName = DeleteBucketLifecycle) || ($.eventName = DeleteBucketReplication)) }',
                description: "CIS 3.8 - Monitors S3 bucket policy changes",
                cisTag: "3.8"
            },
            {
                enabled: cisConfig.enableAwsConfigChanges !== false,
                shortName: "cis-aws-config-changes",
                metricName: "AWSConfigChanges",
                pattern: '{ ($.eventSource = config.amazonaws.com) && (($.eventName = StopConfigurationRecorder) || ($.eventName = DeleteDeliveryChannel) || ($.eventName = PutDeliveryChannel) || ($.eventName = PutConfigurationRecorder)) }',
                description: "CIS 3.9 - Monitors AWS Config configuration changes",
                cisTag: "3.9"
            },
            {
                enabled: cisConfig.enableSecurityGroupChanges !== false,
                shortName: "cis-security-group-changes",
                metricName: "SecurityGroupChanges",
                pattern: '{ ($.eventName = AuthorizeSecurityGroupIngress) || ($.eventName = AuthorizeSecurityGroupEgress) || ($.eventName = RevokeSecurityGroupIngress) || ($.eventName = RevokeSecurityGroupEgress) || ($.eventName = CreateSecurityGroup) || ($.eventName = DeleteSecurityGroup) }',
                description: "CIS 3.10 - Monitors security group changes",
                cisTag: "3.10"
            },
            {
                enabled: cisConfig.enableNetworkAclChanges !== false,
                shortName: "cis-network-acl-changes",
                metricName: "NetworkACLChanges",
                pattern: '{ ($.eventName = CreateNetworkAcl) || ($.eventName = CreateNetworkAclEntry) || ($.eventName = DeleteNetworkAcl) || ($.eventName = DeleteNetworkAclEntry) || ($.eventName = ReplaceNetworkAclEntry) || ($.eventName = ReplaceNetworkAclAssociation) }',
                description: "CIS 3.11 - Monitors Network ACL changes",
                cisTag: "3.11"
            },
            {
                enabled: cisConfig.enableNetworkGatewayChanges !== false,
                shortName: "cis-network-gateway-changes",
                metricName: "NetworkGatewayChanges",
                pattern: '{ ($.eventName = CreateCustomerGateway) || ($.eventName = DeleteCustomerGateway) || ($.eventName = AttachInternetGateway) || ($.eventName = CreateInternetGateway) || ($.eventName = DeleteInternetGateway) || ($.eventName = DetachInternetGateway) }',
                description: "CIS 3.12 - Monitors network gateway changes",
                cisTag: "3.12"
            },
            {
                enabled: cisConfig.enableRouteTableChanges !== false,
                shortName: "cis-route-table-changes",
                metricName: "RouteTableChanges",
                pattern: '{ ($.eventName = CreateRoute) || ($.eventName = CreateRouteTable) || ($.eventName = ReplaceRoute) || ($.eventName = ReplaceRouteTableAssociation) || ($.eventName = DeleteRouteTable) || ($.eventName = DeleteRoute) || ($.eventName = DisassociateRouteTable) }',
                description: "CIS 3.13 - Monitors route table changes",
                cisTag: "3.13"
            },
            {
                enabled: cisConfig.enableVpcChanges !== false,
                shortName: "cis-vpc-changes",
                metricName: "VPCChanges",
                pattern: '{ ($.eventName = CreateVpc) || ($.eventName = DeleteVpc) || ($.eventName = ModifyVpcAttribute) || ($.eventName = AcceptVpcPeeringConnection) || ($.eventName = CreateVpcPeeringConnection) || ($.eventName = DeleteVpcPeeringConnection) || ($.eventName = RejectVpcPeeringConnection) || ($.eventName = AttachClassicLinkVpc) || ($.eventName = DetachClassicLinkVpc) || ($.eventName = DisableVpcClassicLink) || ($.eventName = EnableVpcClassicLink) }',
                description: "CIS 3.14 - Monitors VPC changes",
                cisTag: "3.14"
            }
        ];

        for (const metric of metrics) {
            if (metric.enabled) {
                const {metricFilter, alarm} = this.createMetric(
                    cisConfig.logGroupName,
                    actionArn,
                    namespace,
                    metric.shortName,
                    metric.metricName,
                    metric.pattern,
                    metric.description,
                    metric.cisTag,
                    metric.threshold
                );
                metricFilters.push(metricFilter);
                alarms.push(alarm);
            }
        }

        return {
            metricFilters,
            alarms
        };
    }

    private createMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string,
        shortName: string,
        metricName: string,
        pattern: string,
        description: string,
        cisTag: string,
        threshold?: number
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-${shortName}-filter`,
            {
                name: `${this.config.generalPrefix}-${metricName}`,
                logGroupName: logGroupName,
                pattern: pattern,
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-${shortName}-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/${metricName}`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: threshold || 1,
                alarmDescription: description,
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: cisTag,
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/${metricName}`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }
}

export {AlarmsCIS}
