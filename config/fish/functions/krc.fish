function krc --description "Open Rails console on metafy-api-deployment pod"
    if test (count $argv) -lt 1
        echo "Usage: krc <namespace>"
        return 1
    end

    set -l namespace $argv[1]
    set -l pod (kubectl get pods -n $namespace -l app=metafy-api -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

    if test -z "$pod"
        echo "No metafy-api pod found in namespace: $namespace"
        return 1
    end

    echo "Connecting to $pod in $namespace..."
    kubectl exec -it -n $namespace $pod -- bin/rails console
end
