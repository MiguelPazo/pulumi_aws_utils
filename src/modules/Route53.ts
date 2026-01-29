/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import {Route53WeightedRecordConfig, Route53WeightedRecordResult} from "../types";

class Route53 {
    private static __instance: Route53;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Route53 {
        if (this.__instance == null) {
            this.__instance = new Route53();
        }

        return this.__instance;
    }

    /**
     * Creates a weighted routing DNS record that balances traffic between two DNS endpoints
     * @param config Configuration for weighted record
     * @returns Route53WeightedRecordResult with both records
     */
    async main(config: Route53WeightedRecordConfig): Promise<Route53WeightedRecordResult> {
        const {
            zoneId,
            dns,
            dns1,
            dns2,
            weight1 = 50,
            weight2 = 50,
            ttl = 60
        } = config;

        /**
         * First weighted record pointing to dns1
         */
        const record1 = new aws.route53.Record(`${this.config.project}-${dns}-weighted-1`, {
            name: dns,
            type: aws.route53.RecordType.CNAME,
            zoneId: zoneId,
            ttl: ttl,
            records: [pulumi.output(dns1)],
            setIdentifier: `${dns}-endpoint-1`,
            weightedRoutingPolicies: [{
                weight: weight1
            }]
        });

        /**
         * Second weighted record pointing to dns2
         */
        const record2 = new aws.route53.Record(`${this.config.project}-${dns}-weighted-2`, {
            name: dns,
            type: aws.route53.RecordType.CNAME,
            zoneId: zoneId,
            ttl: ttl,
            records: [pulumi.output(dns2)],
            setIdentifier: `${dns}-endpoint-2`,
            weightedRoutingPolicies: [{
                weight: weight2
            }]
        });

        return {
            record1,
            record2
        };
    }
}

export {Route53}
