import { border, chip, navigation, pulseDot, semantic, surface, text } from "@/lib/theme";

const HEX_OR_RGBA = /^(?:#[0-9a-fA-F]{6,8}|rgba?\([\d\s.,%]+\))$/;

describe("theme tokens", () => {
  it("uses well-formed color values everywhere", () => {
    const flat = [
      ...Object.values(surface),
      ...Object.values(text),
      ...Object.values(semantic),
      ...Object.values(border),
      ...Object.values(pulseDot),
      navigation.itemText,
      navigation.itemSelectedFill,
    ];

    for (const value of flat) {
      expect(value).toMatch(HEX_OR_RGBA);
    }
  });

  it("defines a dot color for every pulse state", () => {
    expect(Object.keys(pulseDot).toSorted()).toStrictEqual([
      "active",
      "awaiting-input",
      "blocked",
      "gone",
      "idle",
      "ready",
    ]);
  });

  it("pairs every chip tone with a tinted background and solid text", () => {
    for (const tone of Object.values(chip)) {
      expect(tone.background).toMatch(HEX_OR_RGBA);
      expect(tone.text).toMatch(HEX_OR_RGBA);
    }
  });
});
