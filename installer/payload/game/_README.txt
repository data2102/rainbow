이 폴더에 "완성된 게임 폴더의 내용물"을 넣으세요.

넣는 것은 게임 폴더 그 자체가 아니라, 그 폴더 "안에 들어있는 것들" 입니다.


  [ 맞는 예 ]
  payload\game\RainbowSix.exe        <- 이렇게 바로 보여야 합니다
  payload\game\data\
  payload\game\mods\
  ...

  [ 틀린 예 ]
  payload\game\Tom Clancy's Rainbow Six\RainbowSix.exe
                                     <- 폴더가 한 겹 더 있으면 안 됩니다


넣는 방법:

  1. 게임이 깔린 폴더를 엽니다
       보통 C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six

  2. Ctrl + A 로 전부 선택, Ctrl + C 로 복사

  3. 이 폴더(payload\game)에 들어와서 Ctrl + V 로 붙여넣기

  4. 다 복사되면 이 안내 파일은 지워도 됩니다

  5. 한 단계 위로 올라가 build.bat 을 더블클릭


주의: 이 폴더의 내용은 저장소에 올라가지 않습니다 (.gitignore 로 막아둠).
      게임 파일을 공개 저장소에 올리지 않기 위한 것입니다.
