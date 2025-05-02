document.addEventListener('DOMContentLoaded', () => {
  const referenceInput = document.getElementById('referenceImage');
  const folderInput = document.getElementById('imageFolder');
  const processBtn = document.getElementById('processBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const resultsDiv = document.getElementById('results');
  const matchCount = document.getElementById('matchCount');
  const matchList = document.getElementById('matchList');
  const referencePreview = document.getElementById('referencePreview');
  const folderInfo = document.getElementById('folderInfo');
  const loader = document.getElementById('loader');
  const chartCanvas = document.getElementById('similarityChart');
  const takePhotoBtn = document.getElementById('takePhotoBtn');
  const video = document.getElementById('camera');
  const canvas = document.getElementById('snapshot');
  const uploadProgress = document.getElementById('uploadProgress');

  let currentMatchId = null;
  let similarityChart = null;
  let capturedBlob = null;
  let allMatches = [];

  referenceInput.addEventListener('change', () => {
    const file = referenceInput.files[0];
    if (file) {
      capturedBlob = null;
      referencePreview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Reference" />`;
    }
  });

  takePhotoBtn.addEventListener('click', async () => {
    if (video.style.display === 'none') {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      video.style.display = 'block';
      takePhotoBtn.textContent = '📸 Capture Photo';
    } else {
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        capturedBlob = new File([blob], 'captured.jpg', { type: 'image/jpeg' });
        referenceInput.value = '';
        referencePreview.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="Captured Image" />`;
      }, 'image/jpeg');
      video.srcObject.getTracks().forEach(track => track.stop());
      video.style.display = 'none';
      takePhotoBtn.textContent = '📸 Take Photo Again';
    }
  });

  folderInput.addEventListener('change', () => {
    folderInfo.textContent = `${folderInput.files.length} image(s) selected.`;
  });

  processBtn.addEventListener('click', async () => {
    const hasUploaded = referenceInput.files[0];
    if (!capturedBlob && !hasUploaded) {
      alert('Please select or capture a reference image.');
      return;
    }

    if (!folderInput.files.length) {
      alert('Please select a folder of images to compare.');
      return;
    }

    processBtn.disabled = true;
    loader.classList.add('active');
    resultsDiv.classList.add('hidden');
    matchList.innerHTML = '';
    matchCount.textContent = '0';
    if (similarityChart) similarityChart.destroy();

    const referenceFile = capturedBlob ? capturedBlob : referenceInput.files[0];
    const imageFiles = Array.from(folderInput.files);

    await uploadImagesInParallel(referenceFile, imageFiles, 50, 3);

    processBtn.disabled = false;
    loader.classList.remove('active');
  });

  downloadBtn.addEventListener('click', async () => {
    if (allMatches.length > 0) {
      const zip = new JSZip();
      allMatches.forEach(match => {
        zip.file(match.filename, match.blob);
      });

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);

      const a = document.createElement('a');
      a.href = url;
      a.download = 'matches.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  });

  async function uploadImagesInParallel(reference, images, batchSize = 50, parallelLimit = 3) {
    const batches = [];
    for (let i = 0; i < images.length; i += batchSize) {
      batches.push(images.slice(i, i + batchSize));
    }

    allMatches = [];
    let completedBatches = 0;

    Swal.fire({
      title: 'Uploading Images...',
      html: '<b>0%</b> completed',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    const batchPromises = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      const formData = new FormData();
      formData.append('reference', reference);
      batch.forEach(file => formData.append('images', file));

      const promise = fetch('/api/process-faces', {
        method: 'POST',
        body: formData
      })
      .then(async res => {
        let data = await res.json();

        if (data.success) {
          completedBatches++;
          const percent = Math.round((completedBatches / batches.length) * 100);
          Swal.getHtmlContainer().querySelector('b').textContent = `${percent}%`;

          for (const match of data.matches) {
            const byteCharacters = atob(match.imageBase64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/jpeg' });

            allMatches.push({
              filename: match.filename,
              similarity: match.similarity,
              blob: blob
            });
          }
        } else {
          throw new Error('Face matching failed: ' + data.error);
        }
      })
      .catch(err => {
        console.error('Batch upload error:', err);
        Swal.close();
        alert('Error while uploading batches.');
        throw err;
      });

      batchPromises.push(promise);

      if (batchPromises.length >= parallelLimit || i === batches.length - 1) {
        try {
          await Promise.all(batchPromises);
        } catch (err) {
          console.error('Error uploading batches:', err);
          Swal.close();
          return;
        }
        batchPromises.length = 0;
      }
    }

    Swal.close();
    matchCount.textContent = allMatches.length;
    renderResults(allMatches);
    downloadBtn.disabled = false;
    resultsDiv.classList.remove('hidden');
  }

  function renderResults(matches) {
    const labels = [];
    const values = [];

    matchList.innerHTML = '';

    matches.forEach(match => {
      const item = document.createElement('div');
      item.className = 'match-item';

      const url = URL.createObjectURL(match.blob);

      item.innerHTML = `
        <img src="${url}" alt="${match.filename}" />
        <span class="filename">${match.filename}</span>
        <span class="similarity">${match.similarity.toFixed(1)}% match</span>
      `;
      matchList.appendChild(item);

      labels.push(match.filename);
      values.push(match.similarity);
    });

    if (chartCanvas && labels.length) {
      if (similarityChart) similarityChart.destroy();

      similarityChart = new Chart(chartCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Similarity %',
            data: values,
            backgroundColor: '#00b894'
          }]
        },
        options: {
          scales: {
            y: {
              beginAtZero: true,
              max: 100
            }
          }
        }
      });
    }
  }
});
