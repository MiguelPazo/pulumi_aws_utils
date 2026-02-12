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

    async main(cisConfig: AlarmsAdminConfig): Promise<AlarmsAdminResult> {
        const metricFilters: aws.cloudwatch.LogMetricFilter[] = [];
        const alarms: aws.cloudwatch.MetricAlarm[] = [];
        const namespace = cisConfig.alarmNamespace || "CISBenchmark";

        // Prioritize lambdaAlarmsArn over snsTopicArn
        const actionArn = cisConfig.lambdaAlarmsArn || cisConfig.snsTopicArn;

        if (!actionArn) {
            throw new Error("Either lambdaAlarmsArn or snsTopicArn must be provided");
        }

        // Set default values to true for all boolean flags
        const config = {
            enableUnauthorizedApiCalls: cisConfig.enableUnauthorizedApiCalls !== false,
            enableConsoleSignInWithoutMfa: cisConfig.enableConsoleSignInWithoutMfa !== false,
            enableRootAccountUsage: cisConfig.enableRootAccountUsage !== false,
            enableIamPolicyChanges: cisConfig.enableIamPolicyChanges !== false,
            enableCloudTrailChanges: cisConfig.enableCloudTrailChanges !== false,
            enableConsoleAuthenticationFailures: cisConfig.enableConsoleAuthenticationFailures !== false,
            enableDisableOrDeleteKms: cisConfig.enableDisableOrDeleteKms !== false,
            enableS3BucketPolicyChanges: cisConfig.enableS3BucketPolicyChanges !== false,
            enableAwsConfigChanges: cisConfig.enableAwsConfigChanges !== false,
            enableSecurityGroupChanges: cisConfig.enableSecurityGroupChanges !== false,
            enableNetworkAclChanges: cisConfig.enableNetworkAclChanges !== false,
            enableNetworkGatewayChanges: cisConfig.enableNetworkGatewayChanges !== false,
            enableRouteTableChanges: cisConfig.enableRouteTableChanges !== false,
            enableVpcChanges: cisConfig.enableVpcChanges !== false
        };

        // CIS 3.1 - Unauthorized API Calls
        if (config.enableUnauthorizedApiCalls) {
            const {metricFilter, alarm} = this.createUnauthorizedApiCallsMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace,
                cisConfig.excludeUnauthorizedApiCallsEventSources
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.2 - Console Sign-in Without MFA
        if (config.enableConsoleSignInWithoutMfa) {
            const {metricFilter, alarm} = this.createConsoleSignInWithoutMfaMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.3 - Root Account Usage
        if (config.enableRootAccountUsage) {
            const {metricFilter, alarm} = this.createRootAccountUsageMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.4 - IAM Policy Changes
        if (config.enableIamPolicyChanges) {
            const {metricFilter, alarm} = this.createIamPolicyChangesMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.5 - CloudTrail Configuration Changes
        if (config.enableCloudTrailChanges) {
            const {metricFilter, alarm} = this.createCloudTrailChangesMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.6 - Console Authentication Failures
        if (config.enableConsoleAuthenticationFailures) {
            const {metricFilter, alarm} = this.createConsoleAuthenticationFailuresMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.7 - Disable or Delete KMS Keys
        if (config.enableDisableOrDeleteKms) {
            const {metricFilter, alarm} = this.createDisableOrDeleteKmsMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.8 - S3 Bucket Policy Changes
        if (config.enableS3BucketPolicyChanges) {
            const {metricFilter, alarm} = this.createS3BucketPolicyChangesMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.9 - AWS Config Configuration Changes
        if (config.enableAwsConfigChanges) {
            const {metricFilter, alarm} = this.createAwsConfigChangesMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.10 - Security Group Changes
        if (config.enableSecurityGroupChanges) {
            const {metricFilter, alarm} = this.createSecurityGroupChangesMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.11 - Network ACL Changes
        if (config.enableNetworkAclChanges) {
            const {metricFilter, alarm} = this.createNetworkAclChangesMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.12 - Network Gateway Changes
        if (config.enableNetworkGatewayChanges) {
            const {metricFilter, alarm} = this.createNetworkGatewayChangesMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.13 - Route Table Changes
        if (config.enableRouteTableChanges) {
            const {metricFilter, alarm} = this.createRouteTableChangesMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        // CIS 3.14 - VPC Changes
        if (config.enableVpcChanges) {
            const {metricFilter, alarm} = this.createVpcChangesMetric(
                cisConfig.cloudTrailLogGroupName,
                actionArn,
                namespace
            );
            metricFilters.push(metricFilter);
            alarms.push(alarm);
        }

        return {
            metricFilters,
            alarms
        };
    }

    /**
     * CIS 3.1 - Monitor unauthorized API calls
     */
    private createUnauthorizedApiCallsMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string,
        excludeEventSources?: string[]
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "UnauthorizedAPICalls";

        // Build filter pattern with exclusions
        let pattern = '{ ($.errorCode = "*UnauthorizedOperation") || ($.errorCode = "AccessDenied*") }';

        if (excludeEventSources && excludeEventSources.length > 0) {
            // Build exclusion conditions
            const exclusions = excludeEventSources.map(source => `($.eventSource != "${source}")`).join(' && ');
            pattern = `{ (($.errorCode = "*UnauthorizedOperation") || ($.errorCode = "AccessDenied*")) && ${exclusions} }`;
        }

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-unauthorized-api-calls-filter`,
            {
                name: `${this.config.generalPrefix}-UnauthorizedAPICalls`,
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
            `${this.config.project}-cis-unauthorized-api-calls-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/UnauthorizedAPICalls`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.1 - Monitors unauthorized API calls",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.1",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/UnauthorizedAPICalls`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.2 - Monitor console sign-in without MFA
     */
    private createConsoleSignInWithoutMfaMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "ConsoleSignInWithoutMFA";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-console-signin-without-mfa-filter`,
            {
                name: `${this.config.generalPrefix}-ConsoleSignInWithoutMFA`,
                logGroupName: logGroupName,
                pattern: '{ ($.eventName = "ConsoleLogin") && ($.additionalEventData.MFAUsed != "Yes") && ($.userIdentity.type = "IAMUser") && ($.responseElements.ConsoleLogin = "Success") }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-console-signin-without-mfa-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/ConsoleSignInWithoutMFA`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.2 - Monitors console sign-in without MFA",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.2",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/ConsoleSignInWithoutMFA`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.3 - Monitor root account usage
     */
    private createRootAccountUsageMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "RootAccountUsage";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-root-account-usage-filter`,
            {
                name: `${this.config.generalPrefix}-RootAccountUsage`,
                logGroupName: logGroupName,
                pattern: '{ $.userIdentity.type = "Root" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != "AwsServiceEvent" }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-root-account-usage-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/RootAccountUsage`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.3 - Monitors root account usage",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.3",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/RootAccountUsage`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.4 - Monitor IAM policy changes
     */
    private createIamPolicyChangesMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "IAMPolicyChanges";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-iam-policy-changes-filter`,
            {
                name: `${this.config.generalPrefix}-IAMPolicyChanges`,
                logGroupName: logGroupName,
                pattern: '{($.eventName=DeleteGroupPolicy)||($.eventName=DeleteRolePolicy)||($.eventName=DeleteUserPolicy)||($.eventName=PutGroupPolicy)||($.eventName=PutRolePolicy)||($.eventName=PutUserPolicy)||($.eventName=CreatePolicy)||($.eventName=DeletePolicy)||($.eventName=CreatePolicyVersion)||($.eventName=DeletePolicyVersion)||($.eventName=AttachRolePolicy)||($.eventName=DetachRolePolicy)||($.eventName=AttachUserPolicy)||($.eventName=DetachUserPolicy)||($.eventName=AttachGroupPolicy)||($.eventName=DetachGroupPolicy)}',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-iam-policy-changes-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/IAMPolicyChanges`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.4 - Monitors IAM policy changes",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.4",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/IAMPolicyChanges`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.5 - Monitor CloudTrail configuration changes
     */
    private createCloudTrailChangesMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "CloudTrailConfigChanges";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-cloudtrail-changes-filter`,
            {
                name: `${this.config.generalPrefix}-CloudTrailConfigChanges`,
                logGroupName: logGroupName,
                pattern: '{ ($.eventName = CreateTrail) || ($.eventName = UpdateTrail) || ($.eventName = DeleteTrail) || ($.eventName = StartLogging) || ($.eventName = StopLogging) }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-cloudtrail-changes-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/CloudTrailConfigChanges`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.5 - Monitors CloudTrail configuration changes",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.5",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/CloudTrailConfigChanges`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.6 - Monitor console authentication failures
     */
    private createConsoleAuthenticationFailuresMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "ConsoleAuthenticationFailures";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-console-auth-failures-filter`,
            {
                name: `${this.config.generalPrefix}-ConsoleAuthenticationFailures`,
                logGroupName: logGroupName,
                pattern: '{ ($.eventName = ConsoleLogin) && ($.errorMessage = "Failed authentication") }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-console-auth-failures-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/ConsoleAuthenticationFailures`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 3,
                alarmDescription: "CIS 3.6 - Monitors console authentication failures",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.6",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/ConsoleAuthenticationFailures`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.7 - Monitor disabling or scheduled deletion of KMS keys
     */
    private createDisableOrDeleteKmsMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "DisableOrDeleteKMSKeys";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-disable-delete-kms-filter`,
            {
                name: `${this.config.generalPrefix}-DisableOrDeleteKMSKeys`,
                logGroupName: logGroupName,
                pattern: '{ ($.eventSource = kms.amazonaws.com) && (($.eventName = DisableKey) || ($.eventName = ScheduleKeyDeletion)) }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-disable-delete-kms-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/DisableOrDeleteKMSKeys`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.7 - Monitors disabling or deletion of KMS keys",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.7",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/DisableOrDeleteKMSKeys`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.8 - Monitor S3 bucket policy changes
     */
    private createS3BucketPolicyChangesMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "S3BucketPolicyChanges";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-s3-bucket-policy-changes-filter`,
            {
                name: `${this.config.generalPrefix}-S3BucketPolicyChanges`,
                logGroupName: logGroupName,
                pattern: '{ ($.eventSource = s3.amazonaws.com) && (($.eventName = PutBucketAcl) || ($.eventName = PutBucketPolicy) || ($.eventName = PutBucketCors) || ($.eventName = PutBucketLifecycle) || ($.eventName = PutBucketReplication) || ($.eventName = DeleteBucketPolicy) || ($.eventName = DeleteBucketCors) || ($.eventName = DeleteBucketLifecycle) || ($.eventName = DeleteBucketReplication)) }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-s3-bucket-policy-changes-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/S3BucketPolicyChanges`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.8 - Monitors S3 bucket policy changes",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.8",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/S3BucketPolicyChanges`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.9 - Monitor AWS Config configuration changes
     */
    private createAwsConfigChangesMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "AWSConfigChanges";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-aws-config-changes-filter`,
            {
                name: `${this.config.generalPrefix}-AWSConfigChanges`,
                logGroupName: logGroupName,
                pattern: '{ ($.eventSource = config.amazonaws.com) && (($.eventName = StopConfigurationRecorder) || ($.eventName = DeleteDeliveryChannel) || ($.eventName = PutDeliveryChannel) || ($.eventName = PutConfigurationRecorder)) }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-aws-config-changes-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/AWSConfigChanges`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.9 - Monitors AWS Config configuration changes",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.9",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/AWSConfigChanges`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.10 - Monitor security group changes
     */
    private createSecurityGroupChangesMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "SecurityGroupChanges";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-security-group-changes-filter`,
            {
                name: `${this.config.generalPrefix}-SecurityGroupChanges`,
                logGroupName: logGroupName,
                pattern: '{ ($.eventName = AuthorizeSecurityGroupIngress) || ($.eventName = AuthorizeSecurityGroupEgress) || ($.eventName = RevokeSecurityGroupIngress) || ($.eventName = RevokeSecurityGroupEgress) || ($.eventName = CreateSecurityGroup) || ($.eventName = DeleteSecurityGroup) }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-security-group-changes-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/SecurityGroupChanges`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.10 - Monitors security group changes",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.10",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/SecurityGroupChanges`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.11 - Monitor Network ACL changes
     */
    private createNetworkAclChangesMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "NetworkACLChanges";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-network-acl-changes-filter`,
            {
                name: `${this.config.generalPrefix}-NetworkACLChanges`,
                logGroupName: logGroupName,
                pattern: '{ ($.eventName = CreateNetworkAcl) || ($.eventName = CreateNetworkAclEntry) || ($.eventName = DeleteNetworkAcl) || ($.eventName = DeleteNetworkAclEntry) || ($.eventName = ReplaceNetworkAclEntry) || ($.eventName = ReplaceNetworkAclAssociation) }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-network-acl-changes-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/NetworkACLChanges`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.11 - Monitors Network ACL changes",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.11",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/NetworkACLChanges`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.12 - Monitor network gateway changes
     */
    private createNetworkGatewayChangesMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "NetworkGatewayChanges";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-network-gateway-changes-filter`,
            {
                name: `${this.config.generalPrefix}-NetworkGatewayChanges`,
                logGroupName: logGroupName,
                pattern: '{ ($.eventName = CreateCustomerGateway) || ($.eventName = DeleteCustomerGateway) || ($.eventName = AttachInternetGateway) || ($.eventName = CreateInternetGateway) || ($.eventName = DeleteInternetGateway) || ($.eventName = DetachInternetGateway) }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-network-gateway-changes-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/NetworkGatewayChanges`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.12 - Monitors network gateway changes",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.12",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/NetworkGatewayChanges`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.13 - Monitor route table changes
     */
    private createRouteTableChangesMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "RouteTableChanges";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-route-table-changes-filter`,
            {
                name: `${this.config.generalPrefix}-RouteTableChanges`,
                logGroupName: logGroupName,
                pattern: '{ ($.eventName = CreateRoute) || ($.eventName = CreateRouteTable) || ($.eventName = ReplaceRoute) || ($.eventName = ReplaceRouteTableAssociation) || ($.eventName = DeleteRouteTable) || ($.eventName = DeleteRoute) || ($.eventName = DisassociateRouteTable) }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-route-table-changes-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/RouteTableChanges`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.13 - Monitors route table changes",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.13",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/RouteTableChanges`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }

    /**
     * CIS 3.14 - Monitor VPC changes
     */
    private createVpcChangesMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricName = "VPCChanges";

        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-cis-vpc-changes-filter`,
            {
                name: `${this.config.generalPrefix}-VPCChanges`,
                logGroupName: logGroupName,
                pattern: '{ ($.eventName = CreateVpc) || ($.eventName = DeleteVpc) || ($.eventName = ModifyVpcAttribute) || ($.eventName = AcceptVpcPeeringConnection) || ($.eventName = CreateVpcPeeringConnection) || ($.eventName = DeleteVpcPeeringConnection) || ($.eventName = RejectVpcPeeringConnection) || ($.eventName = AttachClassicLinkVpc) || ($.eventName = DetachClassicLinkVpc) || ($.eventName = DisableVpcClassicLink) || ($.eventName = EnableVpcClassicLink) }',
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-cis-vpc-changes-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/VPCChanges`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: "CIS 3.14 - Monitors VPC changes",
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    CIS: "3.14",
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/VPCChanges`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }
}

export {AlarmsAdmin}
