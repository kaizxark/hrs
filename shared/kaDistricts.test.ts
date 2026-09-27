import { describe, expect, it } from "vitest";
import {
  KA_DISTRICTS,
  KA_ALL_AREAS,
  KA_AREAS_BY_DISTRICT,
  kaNormalizeDistrict,
  kaNormalizeArea,
  kaAreasForDistrict,
} from "./kaDistricts";

describe("Karnataka district dataset", () => {
  it("has exactly the 31 districts of Karnataka", () => {
    expect(KA_DISTRICTS).toHaveLength(31);
    // spot-check a few, incl. the two newest districts
    for (const d of [
      "Tumakuru",
      "Bengaluru Urban",
      "Vijayanagara",
      "Yadagiri",
    ]) {
      expect(KA_DISTRICTS).toContain(d);
    }
  });

  it("gives every district a non-empty area list with no duplicates", () => {
    expect(KA_DISTRICTS.length).toBeGreaterThan(0);
    for (const district of KA_DISTRICTS) {
      const areas = KA_AREAS_BY_DISTRICT[district];
      expect(areas, district).toBeTruthy();
      expect(areas.length, district).toBeGreaterThan(0);
      expect(new Set(areas).size, district).toBe(areas.length);
    }
  });

  it("keeps the flat area list free of duplicates", () => {
    expect(new Set(KA_ALL_AREAS).size).toBe(KA_ALL_AREAS.length);
  });

  it("keeps Tumakuru's legacy localities so old records keep their area", () => {
    const areas = kaAreasForDistrict("Tumakuru");
    for (const legacy of ["SIT", "SS Puram", "Ashok Nagar", "Kyathsandra"]) {
      expect(areas).toContain(legacy);
    }
  });
});

describe("legacy spelling normalization", () => {
  it("maps anglicized district spellings to official names", () => {
    expect(kaNormalizeDistrict("Tumkur")).toBe("Tumakuru");
    expect(kaNormalizeDistrict("Bangalore")).toBe("Bengaluru Urban");
    expect(kaNormalizeDistrict("Mysore")).toBe("Mysuru");
    expect(kaNormalizeDistrict("Belgaum")).toBe("Belagavi");
    expect(kaNormalizeDistrict("Gulbarga")).toBe("Kalaburagi");
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(kaNormalizeDistrict("  tumkur ")).toBe("Tumakuru");
    expect(kaNormalizeDistrict("BANGALORE")).toBe("Bengaluru Urban");
    expect(kaNormalizeDistrict("mysore")).toBe("Mysuru");
  });

  it("passes official spellings and unknown values through", () => {
    expect(kaNormalizeDistrict("Tumakuru")).toBe("Tumakuru");
    expect(kaNormalizeDistrict("Chamarajanagara")).toBe("Chamarajanagara");
    expect(kaNormalizeDistrict("Someplace Else")).toBe("Someplace Else");
    expect(kaNormalizeDistrict("")).toBe("");
    expect(kaNormalizeDistrict(null)).toBe("");
  });

  it("normalizes legacy area spellings", () => {
    expect(kaNormalizeArea("Tumkur City")).toBe("Tumakuru");
    expect(kaNormalizeArea("tumkur")).toBe("Tumakuru");
    expect(kaNormalizeArea("SIT")).toBe("SIT");
  });
});
