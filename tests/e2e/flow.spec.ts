import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { makePng, scenes } from "./png";

// 기행 하나를 처음부터 끝까지: 교사가 만들고, 학생 둘이 찍고, 교사가 현상한다.
// E2E_SHOTS=<폴더>를 주면 단계마다 화면을 저장한다.

const SHOTS = process.env.E2E_SHOTS;
const photo = (index: number) => ({
  name: `scene${index}.png`,
  mimeType: "image/png",
  buffer: makePng(1200, 900, scenes[index]),
});

async function snap(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, name + ".png") });
}

async function newPhone(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
}

async function joinAs(page: Page, code: string, name: string, team: string, pin: string) {
  await page.goto("/?code=" + code);
  await page.getByRole("button", { name: "다음" }).click();
  await page.getByLabel("이름").fill(name);
  await page.getByRole("button", { name: team }).click();
  await page.getByLabel("PIN 네 자리").fill(pin);
}

async function shoot(page: Page, scene: number, memo = "") {
  await page.locator("input[type=file][capture]").setInputFiles(photo(scene));
  await expect(page.getByRole("button", { name: /필름 감기/ })).toBeVisible();
  if (memo) await page.getByPlaceholder("이 순간을 한두 줄로 남겨 보세요.").fill(memo);
}

test("교사가 만들고, 학생이 찍고, 교사가 현상한다", async ({ browser }) => {
  const teacher = await newPhone(browser);
  const anna = await newPhone(browser);
  const ben = await newPhone(browser);
  let joinCode = "";

  await test.step("교사가 기행을 만든다", async () => {
    const page = teacher.page;
    await page.goto("/");
    await snap(page, "01-입장");
    await page.getByRole("link", { name: /새 기행 만들기/ }).click();
    await page.getByLabel("관리 코드").fill("dev-admin");
    await page.getByLabel("기행 이름").fill("서촌 인문학기행");
    await page.getByLabel("날짜").fill("2026-12-05");
    await page.getByLabel("모둠").fill("1모둠, 2모둠");
    await page.getByLabel("선생님 이름").fill("김교사");
    await page.getByLabel("PIN 네 자리").fill("1234");
    await page.getByRole("button", { name: "기행 만들기" }).click();
    await expect(page.getByText("학생 참가 코드")).toBeVisible();
    joinCode = (await page.locator("p.font-mono").first().innerText()).trim();
    expect(joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    await snap(page, "02-기행-생성");
    await page.getByRole("button", { name: "교사 화면으로" }).click();
    await expect(page.getByRole("button", { name: "현상하기" })).toBeVisible();
  });

  await test.step("틀린 코드는 거부된다", async () => {
    const page = anna.page;
    await page.goto("/?code=ZZZZZZ");
    await page.getByRole("button", { name: "다음" }).click();
    await expect(page.getByText("코드가 맞지 않아요")).toBeVisible();
  });

  await test.step("안나가 입장해 필름을 받는다", async () => {
    const page = anna.page;
    await joinAs(page, joinCode, "안나", "1모둠", "1111");
    await expect(page.getByText("서촌 인문학기행")).toBeVisible();
    await expect(page.getByText("2026년 12월 5일")).toBeVisible();
    await snap(page, "03-이름과-PIN");
    await page.getByRole("button", { name: "필름 받기" }).click();
    await expect(page.getByRole("status", { name: "남은 컷 24" })).toBeVisible();
    await snap(page, "04-카메라");
  });

  await test.step("안나가 두 컷을 찍는다", async () => {
    const page = anna.page;
    await shoot(page, 0, "대오서점 앞. 간판 글씨가 정겹다.");
    await snap(page, "05-감기-전");
    await page.getByRole("button", { name: /필름 감기/ }).click();
    await expect(page.getByRole("status", { name: "남은 컷 23" })).toBeVisible();
    await expect(page.getByText("1번 컷을 감았습니다.")).toBeVisible();

    await shoot(page, 1, "골목 끝 담장");
    await page.getByRole("button", { name: /필름 감기/ }).click();
    await expect(page.getByRole("status", { name: "남은 컷 22" })).toBeVisible();
    await expect(page.getByText("2번 컷을 감았습니다.")).toBeVisible();
    await expect(page.getByText("모두 전송됨")).toBeVisible();
    await snap(page, "06-카메라-두-컷-뒤");
  });

  await test.step("통신이 끊겨도 컷을 잃지 않고, 돌아오면 올라간다", async () => {
    const page = anna.page;
    await anna.context.setOffline(true);
    await shoot(page, 2, "통신이 안 되는 골목");
    await page.getByRole("button", { name: /필름 감기/ }).click();
    await expect(page.getByRole("status", { name: "남은 컷 21" })).toBeVisible();
    await expect(page.getByText("전송 대기 1컷")).toBeVisible();
    await snap(page, "07-전송-대기");

    await anna.context.setOffline(false);
    await expect(page.getByText("모두 전송됨")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole("status", { name: "남은 컷 21" })).toBeVisible();
  });

  await test.step("안나의 인화 화면에는 자기 컷이 보인다", async () => {
    const page = anna.page;
    await page.getByRole("link", { name: "인화" }).click();
    await expect(page.getByText("미현상 · 암실 대기")).toBeVisible();
    await expect(page.getByText("3/24")).toBeVisible();
    await expect(page.getByRole("button", { name: "1번 컷 보기" })).toBeVisible();
    await snap(page, "08-내-필름");
    await page.getByRole("button", { name: "1번 컷 보기" }).click();
    await expect(page.getByText("대오서점 앞. 간판 글씨가 정겹다.")).toBeVisible();
    const image = page.getByRole("dialog").locator("img");
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1200);
    await snap(page, "09-컷-보기");
    await page.getByRole("button", { name: "닫기" }).last().click();
  });

  await test.step("벤이 입장해 한 컷을 찍는다. 안나의 사진은 아직 안 보인다", async () => {
    const page = ben.page;
    await joinAs(page, joinCode, "벤", "2모둠", "2222");
    await page.getByRole("button", { name: "필름 받기" }).click();
    await expect(page.getByRole("status", { name: "남은 컷 24" })).toBeVisible();
    await shoot(page, 2);
    await page.getByRole("button", { name: /필름 감기/ }).click();
    await expect(page.getByText("모두 전송됨")).toBeVisible();

    await page.getByRole("link", { name: "인화" }).click();
    await expect(page.getByRole("heading", { name: "안나" })).toBeVisible();
    await expect(page.getByText(/^\d+미현상$/)).toHaveCount(3); // 안나가 찍은 세 컷은 봉인된 칸으로만 보인다
    await expect(page.getByRole("button", { name: /번 컷 보기/ })).toHaveCount(1);
    await snap(page, "10-벤-미현상");
  });

  await test.step("다른 기기에서 틀린 PIN으로는 안나가 될 수 없다", async () => {
    const thief = await newPhone(browser);
    await joinAs(thief.page, joinCode, "안나", "1모둠", "0000");
    await thief.page.getByRole("button", { name: "필름 받기" }).click();
    await expect(thief.page.getByText(/PIN이 맞지 않아요/)).toBeVisible();
    await thief.context.close();
  });

  await test.step("교사 현황판에 모둠별 진행이 보인다", async () => {
    const page = teacher.page;
    await page.reload();
    await expect(page.getByText("모둠별 현황")).toBeVisible();
    await expect(page.getByText("4컷", { exact: true })).toBeVisible();
    await expect(page.getByText("3/24")).toBeVisible();
    await snap(page, "11-교사-현황");
    await page.getByRole("tab", { name: "코드" }).click();
    await expect(page.getByAltText("입장용 QR 코드")).toBeVisible();
    await snap(page, "12-교사-코드");
    await page.getByRole("tab", { name: "현황" }).click();
  });

  await test.step("교사가 현상하면 벤에게 안나의 사진이 보인다", async () => {
    await teacher.page.getByRole("button", { name: "현상하기" }).click();
    await teacher.page.getByRole("button", { name: "현상합니다" }).click();
    await expect(teacher.page.getByText("현상했습니다. 모두의 사진이 공개됩니다.")).toBeVisible();
    await snap(teacher.page, "13-교사-현상-뒤");

    const page = ben.page;
    await page.reload();
    await expect(page.getByText("현상 완료")).toBeVisible();
    await expect(page.getByRole("button", { name: /번 컷 보기/ })).toHaveCount(4);
    await page.waitForTimeout(4200); // 현상 연출이 끝난 뒤
    await snap(page, "14-벤-현상-뒤");
  });

  await test.step("벤이 안나의 컷에 도장을 찍는다", async () => {
    const page = ben.page;
    const annaRoll = page.locator("section", { has: page.getByRole("heading", { name: "안나" }) });
    await annaRoll.getByRole("button", { name: "1번 컷 보기" }).click();
    const stamp = page.getByRole("button", { name: /뭉클해요/ });
    await stamp.click();
    await expect(stamp).toHaveAttribute("aria-pressed", "true");
    await expect(stamp).toContainText("1");
    await snap(page, "15-도장");
    await page.getByRole("button", { name: "닫기" }).last().click();
  });

  await test.step("안내 화면과 지도 화면이 열린다", async () => {
    const page = ben.page;
    await page.getByRole("link", { name: "안내" }).click();
    await expect(page.getByText("선생님이 아직 안내를 올리지 않았어요.")).toBeVisible();
    await page.getByRole("link", { name: "지도" }).click();
    await expect(page.getByText("아직 장소가 없어요")).toBeVisible();
    await snap(page, "16-지도-키-없음");
  });

  expect([...teacher.errors, ...anna.errors, ...ben.errors]).toEqual([]);
});
