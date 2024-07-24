function metafy_console
  kubectl get pods -n $argv[1] | awk '{print $1}' | grep metafy-api-deployment | xargs -o -I {} kubectl exec -it {} -n $argv[1] -- bin/rails c
end
