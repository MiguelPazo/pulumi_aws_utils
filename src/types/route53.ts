/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type Route53WeightedRecordConfig = {
    zoneId: pulumi.Output<string> | string;
    dns: string;
    dns1: pulumi.Output<string> | string;
    dns2: pulumi.Output<string> | string;
    weight1?: number;
    weight2?: number;
    ttl?: number;
};

export type Route53WeightedRecordResult = {
    record1: aws.route53.Record;
    record2: aws.route53.Record;
};
