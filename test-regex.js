const regex = /(['"]?([a-zA-Z0-9_]+)['"]?\s*:\s*['"]?([^,'"}]+(?:\s+[^,'"}]+)*)['"]?)(?:,|$)/g;
let match;
while ((match = regex.exec('id:faildemo,command:invalid_command_xyz')) !== null) {
  console.log(match[2], ':', match[3]);
}
