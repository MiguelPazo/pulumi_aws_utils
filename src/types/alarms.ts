/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type MetricConfig = {
    namespace: string;
    metric_name: string;
    period: string;
    stat: string;
    unit?: string;
    dimensions?: { [key: string]: string };
};

export type MetricQueryConfig = {
    id: string;
    expression?: string;
    label?: string;
    return_data?: boolean;
    metric?: MetricConfig;
};

export type AlarmConfig = {
    alarm_name: string;
    alarm_description: string;
    alarm_name_suffix?: string;
    comparison_operator: string;
    evaluation_periods: string;
    threshold: string;
    datapoints_to_alarm: string;
    treat_missing_data?: string;

    // For standard metric alarms
    metric_name?: string;
    namespace?: string;
    period?: string;
    statistic?: string;
    dimensions?: { [key: string]: string };

    // For metric math alarms
    metric_query?: MetricQueryConfig[];

    // Optional custom tags for this specific alarm
    tags?: {
        send_to_cs?: boolean;
        dynatrace_link?: string;
        opin_link?: string;
        opin_wait_time?: number;
        opin_oncall?: string;
        opin_tower?: string;
        inc_impact?: number;
        inc_urgency?: number;
        inc_priority?: string;
        [key: string]: any;
    };
};

export type ServiceAlarmConfig = {
    service_name: string;
    service_aws: string;
    tags?: { [key: string]: any };
    alarms: AlarmConfig[];
};

export type AlarmsModuleConfig = {
    alarmsList: ServiceAlarmConfig[];
    snsArn: pulumi.Input<string>;
    snsKmsKey: pulumi.Input<aws.kms.Key>;
    cwLogsKmsKey: pulumi.Input<aws.kms.Key>;
    deployLambdaAlarms?: boolean;
    lambdaAlarmsArn?: pulumi.Input<string>;
    deployLambdaNotifications?: boolean;
    slackWebhookUrl?: pulumi.Input<string>;
    alarmActionsArns?: pulumi.Input<string>[];
    okActionsArns?: pulumi.Input<string>[];
};

export type AlarmsResult = {
    alarms: { [key: string]: aws.cloudwatch.MetricAlarm };
    lambdaFunction?: aws.lambda.Function;
    lambdaRole?: aws.iam.Role;
    lambdaLogGroup?: aws.cloudwatch.LogGroup;
    lambdaNotificationsFunction?: aws.lambda.Function;
    lambdaNotificationsRole?: aws.iam.Role;
    lambdaNotificationsLogGroup?: aws.cloudwatch.LogGroup;
    lambdaNotificationsSnsSubscription?: aws.sns.TopicSubscription;
};

export type AlarmsAdminEBConfig = {
    snsArn: pulumi.Input<string>;
    kmsKey: pulumi.Output<aws.kms.Key>;
    lambdaFunction: aws.lambda.Function;
    monitorVpcChanges?: boolean;
    monitorRouteTableChanges?: boolean;
    monitorSecurityGroupChanges?: boolean;
    monitorNetworkAclChanges?: boolean;
    monitorInternetGatewayChanges?: boolean;
    monitorNetworkGatewayChanges?: boolean;
    monitorAwsConfigChanges?: boolean;
    monitorCloudTrailChanges?: boolean;
    monitorKmsChanges?: boolean;
    monitorS3Changes?: boolean;
    monitorIamChanges?: boolean;
    monitorConsoleLoginFailures?: boolean;
    monitorRootAccountAccess?: boolean;
    monitorAccessWithoutMfa?: boolean;
    monitorUnauthorizedAccess?: boolean;
};

export type AlarmsAdminEBResult = {
    logGroup: aws.cloudwatch.LogGroup;
    logGroupPolicy: aws.cloudwatch.LogResourcePolicy;
    eventRules: aws.cloudwatch.EventRule[];
    eventTargets: aws.cloudwatch.EventTarget[];
};

export type AlarmsAdminConfig = {
    cloudTrailLogGroupName: pulumi.Input<string>;
    snsTopicArn: pulumi.Input<string>;
    alarmNamespace?: string; // Default: "CISBenchmark"
    // All controls are enabled by default (true). Set to false to disable.
    enableUnauthorizedApiCalls?: boolean; // Default: true
    enableConsoleSignInWithoutMfa?: boolean; // Default: true
    enableRootAccountUsage?: boolean; // Default: true
    enableIamPolicyChanges?: boolean; // Default: true
    enableCloudTrailChanges?: boolean; // Default: true
    enableConsoleAuthenticationFailures?: boolean; // Default: true
    enableDisableOrDeleteKms?: boolean; // Default: true
    enableS3BucketPolicyChanges?: boolean; // Default: true
    enableAwsConfigChanges?: boolean; // Default: true
    enableSecurityGroupChanges?: boolean; // Default: true
    enableNetworkAclChanges?: boolean; // Default: true
    enableNetworkGatewayChanges?: boolean; // Default: true
    enableRouteTableChanges?: boolean; // Default: true
    enableVpcChanges?: boolean; // Default: true
};

export type AlarmsAdminResult = {
    metricFilters: aws.cloudwatch.LogMetricFilter[];
    alarms: aws.cloudwatch.MetricAlarm[];
};
