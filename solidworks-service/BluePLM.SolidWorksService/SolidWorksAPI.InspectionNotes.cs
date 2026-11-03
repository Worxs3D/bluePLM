using System;
using System.Collections.Generic;
using System.Linq;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Sheet notes for extractDrawingCharacteristics: every note of the sheet format, every note on
    /// the sheet itself (not in a drawing view) and every note inside a block instance placed on the
    /// sheet or the format. The app parses the title block's general tolerances and the border zone
    /// labels from them. Pure parts (text normalisation, block transform, de-duplication) live in
    /// <see cref="InspectionNative"/> and are unit tested.
    ///
    /// Members were checked by reflection against SolidWorks.Interop.sldworks / swconst 32.1.0, as
    /// in SolidWorksAPI.InspectionNative.cs. Runtime behaviour NOT verified on a real SOLIDWORKS
    /// session (numbering continues that file's R1-R13):
    ///   R14 IView.GetNotes on a sheet's own view returns the sheet-level notes and, while the
    ///       document is in sheet (not format) editing mode, NOT the sheet format's notes. Should it
    ///       return them too, MergeSheetNotes keeps them once as "format" when the format pass sees
    ///       them, or as "sheet" if the format pass could not run.
    ///   R15 IDrawingDoc.EditTemplate followed by IDrawingDoc.GetFirstView gives the active sheet's
    ///       view whose GetNotes returns the sheet format's notes; EditSheet returns to sheet editing.
    ///       ActivateSheet, EditTemplate and EditSheet work on a document opened invisibly, and none
    ///       of them sets the document's save flag. If the flag does go from clean to set on a
    ///       document the user had open, the document is reloaded from disk with
    ///       ReloadOrReplace(false, path, true) (R11), which loses nothing since it was clean.
    ///   R16 ISheet.TitleBlock.GetNotes returns the notes of a defined title block without any mode
    ///       change (null when the format defines no title block).
    ///   R17 INote.GetText returns the evaluated text (property links resolved, $PRP tokens
    ///       replaced by values); lines are separated by CR/LF. INote.GetHeight is the character
    ///       height in metres.
    ///   R18 ISketch.GetSketchBlockInstances on IView.GetSketch (sheet view) and on
    ///       ISheet.GetTemplateSketch returns the block instances placed on the sheet and on the
    ///       format. ISketchBlockInstance.GetAttributes returns the instance's attribute notes with
    ///       their instance values, positioned in sheet coordinates.
    ///   R19 ISketchBlockDefinition.GetNotes returns the definition's notes positioned in block
    ///       space, and ISketchBlockInstance.BlockToSketchTransform maps block space to sheet
    ///       coordinates (row-vector convention, see InspectionNative.TransformPoint).
    ///   R20 ISheet.GetDrawingZone answers only for the active sheet, or only when the sheet format
    ///       defines zones (Sheet Format > zone settings, SOLIDWORKS 2019+); a format that draws its
    ///       zone letters as plain notes and lines has no zones and returns "". The format pass
    ///       retries GetDrawingZone with each sheet active for characteristics that got no zone, and
    ///       logs the result and ISheet.GetZoneSizeDistribution so the log shows which case it is.
    /// </summary>
    public partial class SolidWorksAPI
    {
        /// <summary>
        /// Fill <c>data.Sheets[*].Notes</c>. Never throws: a sheet whose notes cannot be read gets
        /// what was read (possibly nothing), and the failure is logged.
        /// </summary>
        private static void ReadSheetNotesInto(ModelDoc2 doc, DrawingDoc drw, List<InspectionSheet> sheets,
            ExtractedDrawingCharacteristicsData data, string filePath, bool wasAlreadyOpen)
        {
            try
            {
                var format = sheets.ToDictionary(s => s.Name, _ => new List<ExtractedSheetNote>(), StringComparer.OrdinalIgnoreCase);
                var sheetLevel = sheets.ToDictionary(s => s.Name, _ => new List<ExtractedSheetNote>(), StringComparer.OrdinalIgnoreCase);
                var block = sheets.ToDictionary(s => s.Name, _ => new List<ExtractedSheetNote>(), StringComparer.OrdinalIgnoreCase);
                // Sheets where any notes read failed or was skipped: their notesRead is false.
                var failed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                void Fail(string sheetName, string what, Exception? ex)
                {
                    failed.Add(sheetName);
                    Console.Error.WriteLine($"[InspectionNative] Sheet {sheetName}: reading {what} failed{(ex != null ? ": " + ex.Message : "")}");
                }

                // 1. Reads that need no mode change.
                foreach (var sheet in sheets)
                {
                    try
                    {
                        if (sheet.SheetView == null || sheet.Sheet == null)
                        {
                            Fail(sheet.Name, "the sheet (no sheet view)", null);
                            continue;
                        }

                        object? rawNotes = null;
                        try { rawNotes = sheet.SheetView.GetNotes(); } catch (Exception ex) { Fail(sheet.Name, "sheet notes", ex); }
                        sheetLevel[sheet.Name].AddRange(ReadNotes(rawNotes, InspectionNative.NoteSourceSheet, skipAttributes: true,
                            onFail: ex => Fail(sheet.Name, "a sheet note", ex)));

                        Sketch? sheetSketch = null;
                        try { sheetSketch = sheet.SheetView.GetSketch() as Sketch; } catch (Exception ex) { Fail(sheet.Name, "sheet sketch", ex); }
                        block[sheet.Name].AddRange(ReadBlockNotes(sheetSketch, sheet.Name, Fail));

                        Sketch? templateSketch = null;
                        try { templateSketch = sheet.Sheet.GetTemplateSketch(); } catch (Exception ex) { Fail(sheet.Name, "format sketch", ex); }
                        block[sheet.Name].AddRange(ReadBlockNotes(templateSketch, sheet.Name, Fail));

                        object? titleNotes = null;
                        try { titleNotes = sheet.Sheet.TitleBlock?.GetNotes(); } catch (Exception ex) { Fail(sheet.Name, "title block", ex); }
                        format[sheet.Name].AddRange(ReadNotes(titleNotes, InspectionNative.NoteSourceFormat, skipAttributes: true,
                            onFail: ex => Fail(sheet.Name, "a title block note", ex)));
                    }
                    catch (Exception ex) { Fail(sheet.Name, "notes", ex); }
                }

                // 2. The sheet format's own notes, in format editing mode (R15).
                ReadFormatNotes(doc, drw, sheets, format, data, filePath, wasAlreadyOpen, Fail);

                foreach (var wire in data.Sheets)
                {
                    if (!format.ContainsKey(wire.Name)) { wire.NotesRead = false; continue; }
                    wire.Notes = InspectionNative.MergeSheetNotes(format[wire.Name], sheetLevel[wire.Name], block[wire.Name]);
                    wire.NotesRead = !failed.Contains(wire.Name);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[InspectionNative] Reading sheet notes failed, sheets carry no notes: {ex.Message}");
                foreach (var wire in data.Sheets) { wire.Notes = new List<ExtractedSheetNote>(); wire.NotesRead = false; }
            }
        }

        /// <summary>Records that a notes read on a sheet failed or was skipped (logged; notesRead false).</summary>
        private delegate void NotesFailure(string sheetName, string what, Exception? ex);

        /// <summary>
        /// Activate each sheet, switch to format editing, read the format notes, then restore the
        /// user's active sheet and editing mode. Skipped while the user is editing a block. Also
        /// retries GetDrawingZone with the sheet active for characteristics that got no zone (R20).
        /// </summary>
        private static void ReadFormatNotes(ModelDoc2 doc, DrawingDoc drw, List<InspectionSheet> sheets,
            Dictionary<string, List<ExtractedSheetNote>> format, ExtractedDrawingCharacteristicsData data,
            string filePath, bool wasAlreadyOpen, NotesFailure fail)
        {
            void SkipAll(string why)
            {
                foreach (var s in sheets) fail(s.Name, "sheet format notes (skipped: " + why + ")", null);
            }

            bool? editingBlock = null;
            try { editingBlock = drw.GetEditBlock(); } catch { }
            if (editingBlock != false && wasAlreadyOpen)
            {
                SkipAll(editingBlock == true ? "a block is being edited" : "edit-block state unknown");
                return;
            }

            // The user's sheet and editing mode must be known before anything is switched, so they
            // can be put back. A document this call opened is closed unsaved, so there it may go ahead.
            string? originalSheet = OriginalSheetName(drw);
            bool? editingSheet = null;
            try { editingSheet = drw.GetEditSheet(); } catch { }
            if (wasAlreadyOpen && (string.IsNullOrEmpty(originalSheet) || editingSheet == null))
            {
                SkipAll("the open drawing's active sheet or editing mode could not be read");
                return;
            }

            bool dirtyBefore = true;
            try { dirtyBefore = doc.GetSaveFlag(); } catch { }

            try
            {
                foreach (var sheet in sheets)
                {
                    try
                    {
                        if (!drw.ActivateSheet(sheet.Name))
                        {
                            fail(sheet.Name, "sheet format notes (sheet could not be activated)", null);
                            continue;
                        }

                        RetryZones(sheet, data);

                        drw.EditTemplate();
                        var view = drw.GetFirstView() as View;
                        string? viewSheet = null;
                        try { viewSheet = view?.Sheet?.GetName(); } catch { }
                        if (view == null || (viewSheet != null && !string.Equals(viewSheet, sheet.Name, StringComparison.OrdinalIgnoreCase)))
                        {
                            fail(sheet.Name, $"sheet format notes (format view not found, got {viewSheet ?? "none"})", null);
                            continue;
                        }
                        format[sheet.Name].AddRange(ReadNotes(view.GetNotes(), InspectionNative.NoteSourceFormat, skipAttributes: true,
                            onFail: ex => fail(sheet.Name, "a sheet format note", ex)));
                    }
                    catch (Exception ex) { fail(sheet.Name, "sheet format notes", ex); }
                    finally
                    {
                        try { drw.EditSheet(); } catch { }
                    }
                }
            }
            finally
            {
                // The user's sheet and mode, on every path.
                if (!string.IsNullOrEmpty(originalSheet)) { try { drw.ActivateSheet(originalSheet); } catch { } }
                try
                {
                    if (editingSheet == false) drw.EditTemplate();
                    else drw.EditSheet();
                }
                catch { }
                try { doc.ClearSelection2(true); } catch { }

                // Never leave a document the user had open dirty (R15). One this call opened is
                // closed without saving by the caller.
                bool dirtyAfter = false;
                try { dirtyAfter = doc.GetSaveFlag(); } catch { }
                if (wasAlreadyOpen && !dirtyBefore && dirtyAfter)
                {
                    int reload = -1;
                    try { reload = doc.ReloadOrReplace(false, filePath, true); } catch { }
                    Console.Error.WriteLine($"[InspectionNative] Reading format notes marked the open drawing modified; reloaded from disk (reload={reload})");
                }
            }
        }

        /// <summary>The active sheet's name: GetCurrentSheet, then IGetCurrentSheet. Null when neither answers.</summary>
        private static string? OriginalSheetName(DrawingDoc drw)
        {
            try
            {
                var name = (drw.GetCurrentSheet() as Sheet)?.GetName();
                if (!string.IsNullOrEmpty(name)) return name;
            }
            catch { }
            try
            {
                var name = drw.IGetCurrentSheet()?.GetName();
                if (!string.IsNullOrEmpty(name)) return name;
            }
            catch { }
            return null;
        }

        /// <summary>GetDrawingZone again with the sheet active, for characteristics on it that got no zone (R20).</summary>
        private static void RetryZones(InspectionSheet sheet, ExtractedDrawingCharacteristicsData data)
        {
            if (sheet.Sheet == null) return;
            var missing = data.Characteristics
                .Where(c => c.Zone == null && string.Equals(c.Sheet, sheet.Name, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (missing.Count == 0) return;

            int recovered = 0;
            foreach (var c in missing)
            {
                try
                {
                    var z = sheet.Sheet.GetDrawingZone(c.X, c.Y);
                    if (!string.IsNullOrWhiteSpace(z)) { c.Zone = z.Trim(); recovered++; }
                }
                catch { }
            }

            int rows = -1, cols = -1, distribution = -1;
            try { distribution = sheet.Sheet.GetZoneSizeDistribution(out rows, out cols); } catch { }
            Console.Error.WriteLine($"[InspectionNative] Sheet {sheet.Name}: {missing.Count} characteristics had no zone; " +
                                    $"{recovered} found with the sheet active (zone distribution={distribution}, {rows}x{cols}) (R20)");
        }

        /// <summary>Notes of every block instance in a sketch (sheet sketch or format sketch).</summary>
        private static List<ExtractedSheetNote> ReadBlockNotes(Sketch? sketch, string sheetName, NotesFailure fail)
        {
            var result = new List<ExtractedSheetNote>();
            if (sketch == null) return result;
            object? raw = null;
            try { raw = sketch.GetSketchBlockInstances(); } catch (Exception ex) { fail(sheetName, "block instances", ex); }
            if (!(raw is Array instances)) return result;

            foreach (var item in instances)
            {
                if (!(item is SketchBlockInstance inst)) continue;
                try
                {
                    string layer = "";
                    try { layer = inst.Layer ?? ""; } catch { }
                    if (string.Equals(layer, InspectionNative.BalloonLayer, StringComparison.OrdinalIgnoreCase)) continue;
                    try { if (inst.Visible == (int)swVisibilityState_e.swVisibilityStateHide) continue; } catch { }
                    try { if (inst.TextDisplay == (int)swBlockInstanceTextDisplay_e.swBlockInstanceTextDisplayNone) continue; } catch { }

                    // Attribute notes carry the instance's values and sheet positions (R18).
                    object? attributes = null;
                    try { attributes = inst.GetAttributes(); } catch (Exception ex) { fail(sheetName, "block attributes", ex); }
                    result.AddRange(ReadNotes(attributes, InspectionNative.NoteSourceBlock, skipAttributes: false,
                        onFail: ex => fail(sheetName, "a block attribute", ex)));

                    // The definition's plain notes are in block space (R19).
                    double[]? transform = null;
                    try { transform = InspectionNative.Doubles(inst.BlockToSketchTransform?.ArrayData); } catch { }
                    if (transform == null) { fail(sheetName, "a block transform", null); continue; }
                    object? definitionNotes = null;
                    try { definitionNotes = inst.Definition?.GetNotes(); } catch (Exception ex) { fail(sheetName, "block definition notes", ex); }
                    var scale = transform.Length >= 13 && transform[12] != 0 ? Math.Abs(transform[12]) : 1.0;
                    result.AddRange(ReadNotes(definitionNotes, InspectionNative.NoteSourceBlock, skipAttributes: true,
                        map: (x, y) => InspectionNative.TransformPoint(transform, x, y), heightScale: scale, onFail: ex => fail(sheetName, "a block note", ex)));
                }
                catch (Exception ex) { fail(sheetName, "a block instance", ex); }
            }
            return result;
        }

        /// <summary>
        /// Wire notes from a COM array of INote. Hidden notes, notes on the BluePLM balloon layer and
        /// notes with no text are left out; <paramref name="skipAttributes"/> leaves out block
        /// attribute notes (read from their instance instead).
        /// </summary>
        private static List<ExtractedSheetNote> ReadNotes(object? raw, string source, bool skipAttributes,
            Func<double, double, (double X, double Y)?>? map = null, double heightScale = 1.0, Action<Exception?>? onFail = null)
        {
            var result = new List<ExtractedSheetNote>();
            if (!(raw is Array notes)) return result;
            foreach (var item in notes)
            {
                if (!(item is Note note)) { onFail?.Invoke(null); continue; }
                try
                {
                    if (skipAttributes)
                    {
                        try { if (note.IsAttribute()) continue; } catch { }
                    }
                    try { if (!note.Visible) continue; } catch { }

                    var ann = note.GetAnnotation() as Annotation;
                    if (ann != null)
                    {
                        string layer = "";
                        try { layer = ann.Layer ?? ""; } catch { }
                        if (string.Equals(layer, InspectionNative.BalloonLayer, StringComparison.OrdinalIgnoreCase)) continue;
                        try { if (ann.Visible == (int)swAnnotationVisibilityState_e.swAnnotationHidden) continue; } catch { }
                    }

                    var text = InspectionNative.NormalizeNoteText(note.GetText());
                    if (text.Length == 0) continue;

                    double[]? pos = null;
                    try { pos = InspectionNative.Doubles(ann?.GetPosition()); } catch { }
                    if (pos == null || pos.Length < 2) { try { pos = InspectionNative.Doubles(note.GetTextPoint()); } catch { } }
                    if (pos == null || pos.Length < 2) { onFail?.Invoke(null); continue; }

                    double x = pos[0], y = pos[1];
                    if (map != null)
                    {
                        var mapped = map(x, y);
                        if (mapped == null) { onFail?.Invoke(null); continue; }
                        (x, y) = mapped.Value;
                    }

                    double? height = null;
                    try
                    {
                        var h = note.GetHeight();
                        if (h > 0 && !double.IsNaN(h) && !double.IsInfinity(h)) height = h * heightScale;
                    }
                    catch { }

                    result.Add(new ExtractedSheetNote { Text = text, X = x, Y = y, Height = height, Source = source });
                }
                catch (Exception ex) { onFail?.Invoke(ex); }
            }
            return result;
        }
    }
}
