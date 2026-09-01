여기에는 "레나스킨_V2 폴더 안의 내용물"을 넣습니다.

폴더 자체가 아니라, 그 안에 들어있는 것들입니다.

  [ 맞는 예 ]
  payload\skin\character\      <- 이렇게 바로 보여야 합니다
  payload\skin\save\
  payload\skin\sound\
  payload\skin\texture\

  [ 틀린 예 ]
  payload\skin\레나스킨_V2\character\
                               <- 폴더가 한 겹 더 있으면 안 됩니다


넣는 방법:

  1. 레나스킨_V2 폴더를 엽니다
  2. Ctrl + A 로 전부 선택, Ctrl + C 로 복사
  3. 이 폴더(payload\skin)에 들어와 Ctrl + V 로 붙여넣기


설치할 때 이 안의 내용이 게임의 data 폴더 위에 덮어씌워집니다.

  payload\skin\character\...  ->  ...\Tom Clancy's Rainbow Six\data\character\...

덮이는 원본 파일은 게임 폴더의 R6Clan_Backup\ 안에 챙겨둡니다.
스킨이 마음에 안 들면 거기서 되돌릴 수 있습니다.
