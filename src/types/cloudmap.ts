/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type CloudMapConfig = {
    name: string;
    nameShort: string;
    description?: string;
};

export type CloudMapResult = {
    namespace: aws.servicediscovery.PrivateDnsNamespace;
    namespaceId: pulumi.Output<string>;
    namespaceArn: pulumi.Output<string>;
    namespaceName: pulumi.Output<string>;
};
