/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */

export type LambdaRestartConfig = {
    lambdaName: string;
    cronExpression: string;
    eventData: {
        cluster_name: string;
        service_name: string;
    };
    redisHost?: string;
    redisPort?: string;
    redisAuth?: string;
};