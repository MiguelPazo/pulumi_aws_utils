/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {VpcImportResult} from "./vpc";

export type LambdaRestartConfig = {
    lambdaName: string;
    cronExpression: string;
    eventData: {
        cluster_name: string;
        service_name: string;
    };
};