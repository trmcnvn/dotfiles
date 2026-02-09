# Open Rails console on metafy-api pod in given namespace
def krc [namespace: string] {
    let pod = (kubectl get pods
        -n $namespace
        -l app=metafy-api
        -o jsonpath='{.items[0].metadata.name}'
        | str trim)

    if ($pod | is-empty) {
        error make { msg: $"No metafy-api pod found in namespace: ($namespace)" }
    }

    print $"Connecting to ($pod) in ($namespace)..."
    kubectl exec -it -n $namespace $pod -- bin/rails console
}
