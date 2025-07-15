function share -a file -d "Upload a file to https://0x0.st"
  set url (curl -F "file=@$file" -Fexpires=1 https:/0x0.st | xargs echo -n)
  echo $url | wl-copy
  printf "> Uploaded $file at $url (copied to clipboard)\n"
end
